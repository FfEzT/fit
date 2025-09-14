import { Plugin, SettingTab, ItemView, WorkspaceLeaf, View } from 'obsidian';
import { VIEW_TYPE } from 'src/const';
import { Fit, OctokitHttpError } from 'src/fit';
import FitNotice from 'src/fitNotice';
import FitSettingTab from 'src/fitSetting';
import { FitSync } from 'src/fitSync';
import { showFileOpsRecord, showUnappliedConflicts } from 'src/utils';
import { VaultOperations } from 'src/vaultOps';

export interface SyncSetting {
    pat: string;
    owner: string;
    avatarUrl: string;
    repo: string;
    branch: string;
    syncPath: string;
    deviceName: string;
    excludes: string[]
}

export interface LocalStores {
    localSha: Record<string, string>
    lastFetchedCommitSha: string | null
    lastFetchedRemoteSha: Record<string, string>
}

export interface Repository {
    settings: SyncSetting
    localStore: LocalStores
}

export interface FitStorage {
    repo: Repository[]

    checkEveryXMinutes: number;
    autoSync: "on" | "off" | "muted" | "remind";
    notifyChanges: boolean;
    notifyConflicts: boolean;
}

export const DEFAULT_LOCAL_STORE: LocalStores = {
    localSha: {},
    lastFetchedCommitSha: null,
    lastFetchedRemoteSha: {}
}

export const DEFAULT_REPOSITORY = {
    settings: {
        pat: "",
        owner: "",
        avatarUrl: "",
        repo: "",
        branch: "",
        syncPath: "",
        deviceName: "",
        excludes: []
    },
    localStore: {...DEFAULT_LOCAL_STORE}
}


const DEFAULT_SETTINGS: FitStorage = {
    repo: [DEFAULT_REPOSITORY],
    checkEveryXMinutes: 5,
    autoSync: "off",
    notifyChanges: true,
    notifyConflicts: true,
}


export default class FitPlugin extends Plugin {
    storage: FitStorage;

    settingTab: FitSettingTab
    // localStore: LocalStores

    fits: Fit[] = [];
    fitSync: FitSync[] = []

    vaultOps: VaultOperations;
    autoSyncing: boolean
    syncing: boolean
    autoSyncIntervalId: number | null
    fitPullRibbonIconEl: HTMLElement
    fitPushRibbonIconEl: HTMLElement
    fitSyncRibbonIconEl: HTMLElement

    // if settings not configured, open settings to let user quickly setup
    // Note: this is not a stable feature and might be disabled at any point in the future
    openPluginSettings() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const appWithSetting = this.app as any as {
            setting: {
                open(): void;
                openTabById(id: string): SettingTab | null;
            }
        }
        appWithSetting.setting.open()
        appWithSetting.setting.openTabById("fit")
    }

    async checkSettingsConfigured(): Promise<boolean> {
        const actionItems: Array<string> = []
        const settings = this.storage.repo;

        const folders = await this.vaultOps.getFoldersInVault()
        const setSyncPath = new Set()

        for (let i_ in settings) {
            const i = Number(i_)
            const currentSetting = settings[i].settings

            if (currentSetting.pat === "") {
                actionItems.push(`provide GitHub personal access token for repository: ${i+1}`)
            }
            if (currentSetting.owner === "") {
                actionItems.push(`enter your Github nickname for repository: ${i+1}`)
            }
            if (currentSetting.repo === "") {
                actionItems.push(`enter a repository to sync: ${i+1}`)
            }
            if (currentSetting.branch === "") {
                actionItems.push(`enter a branch to sync: ${i+1}`)
            }
            if ( !folders.contains(currentSetting.syncPath) ) {
                actionItems.push(`enter a directory (syncPath): ${i+1}`)
            }
            for (let exlude of currentSetting.excludes) {
                if (exlude.startsWith(currentSetting.syncPath)) {
                    continue
                }
                actionItems.push(`enter a proper exlude (in syncPath) for repository: ${i+1}`)
                break
            }

            setSyncPath.add(currentSetting.syncPath)
        }

        if (setSyncPath.size != settings.length) {
            actionItems.push("Remove duplicate syncPaths")
        }


        if (actionItems.length > 0) {
            const initialMessage = "Settings not configured, please complete the following action items:\n" + actionItems.join("\n")
            const settingsNotice = new FitNotice(["static"], initialMessage)
            // this.openPluginSettings()
            settingsNotice.remove("static")
            return false
        }

        // this.fit.loadSettings(currentSetting)
        return true
    }

    // use of arrow functions to ensure this refers to the FitPlugin class
    saveLocalStoreCallback = async (path: string, localStore: Partial<LocalStores>): Promise<void> => {
        const i = this.storage.repo.findIndex(
            (storage, _) => storage.settings.syncPath === path
        )

        if (i < 0) {
            // TODO show error
            return
        }

        await this.loadSettings()

        this.storage.repo[i].localStore = {
            ...this.storage.repo[i].localStore,
            ...localStore
        }

        await this.saveSettings()
    }

    sync = async (syncNotice: FitNotice): Promise<void> => {
        if (!this.checkSettingsConfigured()) { return }
        // await this.loadLocalStore()
        for (let i_ in this.fitSync) {
            let i = Number(i_)
            const fitSync = this.fitSync[i]

            const syncRecords = await fitSync.sync(syncNotice)
            if (!syncRecords)
                continue

            let { ops, clash } = syncRecords
            const basepath = this.storage.repo[i].settings.syncPath
            clash = clash.map(
                el => {
                    return {
                        ...el,
                        path: basepath + el.path
                    }
                }
            )
            if (this.storage.notifyConflicts)
                showUnappliedConflicts(clash)

            if (this.storage.notifyChanges)
                showFileOpsRecord(ops)
        }
    }

    // wrapper to convert error to notice, return true if error is caught
    catchErrorAndNotify = async <P extends unknown[], R>(func: (notice: FitNotice, ...args: P) => Promise<R>, notice: FitNotice, ...args: P): Promise<R | true> => {
        try {
            const result = await func(notice, ...args)
            return result
        } catch (error) {
            if (error instanceof OctokitHttpError) {
                console.log("error.status")
                console.log(error.status)
                switch (error.source) {
                    case 'getTree':
                    case 'getRef':
                        console.error("Caught error from getRef: ", error.message)
                        if (error.status === 404) {
                            notice.setMessage("Failed to get ref, make sure your repo name and branch name are set correctly.", true)
                            return true
                        }
                        notice.setMessage("Unknown error in getting ref, refers to console for details.", true)
                        return true
                    case 'getCommitTreeSha':
                    case 'getRemoteTreeSha':
                    case 'createBlob':
                    case 'createTreeNodeFromFile':
                    case 'createCommit':
                    case 'updateRef':
                    case 'getBlob':
                }
                return true
            }
            console.error("Caught unknown error: ", error)
            notice.setMessage("Unable to sync, if you are not connected to the internet, turn off auto sync.", true)
            return true
        }
    }

    // TODO change
    async getDiff() {
        // TODO проверять, что есть файлы _fit/conflict else error
        /* TODO
        Если файл бинарный, то просто писать, что он изменен
        Если файла нет в репозитории, но есть в fit, то писать, что файл был удален, но мы его поменяли
        Создавать заметку conflictCanges в _fit Где будет такая структура
        этот файл будет создаваться при нажатии на кнопку и перезаписываться, если он есть
        >>>>>>>>>>----------start of the <file path>
        ---local line
        <content>
        ---remote line
        <content>

        >>>>>>>>>>----------start of the <file path>
        local:  changed
        remote: deleted

        */
        // Получаем активный файл
        const activeFile = this.app.workspace.getActiveFile();

        if (!activeFile) {
            // TODO add ошибку
            console.log('Нет активного файла');
            return;
        }

        const fileName = activeFile.basename; // Имя файла без расширения
        const filePath = activeFile.path; // Полный путь

        // Получаем или создаем view
        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]

        if (!leaf) {
          leaf = this.app.workspace.getLeaf(false);
          await leaf.setViewState({
            type: VIEW_TYPE,
            active: true,
          })
        }

        this.app.workspace.revealLeaf(leaf);

        const view = leaf.view
        if (view instanceof FileNameView) {
            view.updateContent(fileName, filePath);
        }

        // const files = await this.vaultOps.getFilesInVault()
        // const conflictFiles = files.filter(
        //     el => el.startsWith(conflictResolutionFolder)
        // )
        // return
    }

    loadRibbonIcons() {
        // Pull from remote then Push to remote if no clashing changes detected during pull
        this.fitSyncRibbonIconEl = this.addRibbonIcon('github', 'Fit Sync', async (evt: MouseEvent) => {
            if (this.syncing || this.autoSyncing) { return }
            this.syncing = true
            this.fitSyncRibbonIconEl.addClass('animate-icon');
            const syncNotice = new FitNotice(["loading"], "Initiating sync");
            const errorCaught = await this.catchErrorAndNotify(this.sync, syncNotice);
            this.fitSyncRibbonIconEl.removeClass('animate-icon');
            if (errorCaught === true) {
                syncNotice.remove("error")
                this.syncing = false
                return
            }
            syncNotice.remove("done")
            this.syncing = false
        });
        this.fitSyncRibbonIconEl.addClass('fit-sync-ribbon-el');

        this.addRibbonIcon(
            "git-compare-arrows",
            "Fit: show diff",
            async () => {
                const res = await this.getDiff()
            }
        )

        this.registerView(VIEW_TYPE, (leaf) => new FileNameView(leaf))
    }

    async autoSync() {
        if (this.syncing || this.autoSyncing) { return }
        this.autoSyncing = true
        const syncNotice = new FitNotice(
            ["loading"],
            "Auto syncing",
            0,
            this.storage.autoSync === "muted"
        );
        const errorCaught = await this.catchErrorAndNotify(this.sync, syncNotice);
        if (errorCaught === true) {
            syncNotice.remove("error")
        } else {
            syncNotice.remove()
        }
        this.autoSyncing = false
    }

    async autoUpdate() {
        if (!(this.storage.autoSync === "off") && !this.syncing && !this.autoSyncing && await this.checkSettingsConfigured()) {
            if (this.storage.autoSync === "on" || this.storage.autoSync === "muted") {
                await this.autoSync();
            } else if (this.storage.autoSync === "remind") {
                for (let fit of this.fits) {
                    const { updated } = await fit.remoteUpdated();

                    if (updated) {
                        const initialMessage = "Remote update detected, please pull the latest changes.";
                        const intervalNotice = new FitNotice(["static"], initialMessage);
                        intervalNotice.remove("static");
                    }
                }
            }
        }
    }


    async startOrUpdateAutoSyncInterval() {
        // Clear existing interval if it exists
        if (this.autoSyncIntervalId !== null) {
            window.clearInterval(this.autoSyncIntervalId);
            this.autoSyncIntervalId = null;
        }

        // Check remote every X minutes (set in settings)
        this.autoSyncIntervalId = window.setInterval(async () => {
            await this.autoUpdate();
        }, this.storage.checkEveryXMinutes * 60 * 1000);
    }

    async onload() {
        await this.loadSettings();

        this.vaultOps = new VaultOperations(this.app.vault)

        const excludes = this.getExcludes()
        for (let repo_ of this.storage.repo) {
            let repo = structuredClone(repo_)

            for (let exclude of excludes) {
                if (exclude === repo.settings.syncPath)
                    continue

                repo.settings.excludes.push(exclude)
            }

            const fit = new Fit(repo, this.vaultOps)

            this.fits.push(fit)
            this.fitSync.push(
                new FitSync(fit, this.vaultOps, this.saveLocalStoreCallback)
            )
        }

        this.syncing = false
        this.autoSyncing = false
        this.settingTab = new FitSettingTab(this.app, this)
        this.loadRibbonIcons();

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new FitSettingTab(this.app, this));

        // register interval to repeat auto check
        await this.startOrUpdateAutoSyncInterval();
    }

    onunload() {
        if (this.autoSyncIntervalId !== null) {
            window.clearInterval(this.autoSyncIntervalId);
            this.autoSyncIntervalId = null;
        }
    }

    async loadSettings() {
        const userSetting = await this.loadData()
        const settings = Object.assign({}, DEFAULT_SETTINGS, userSetting);
        const settingsObj: FitStorage = Object.keys(DEFAULT_SETTINGS).reduce(
            (obj, key: keyof FitStorage) => {
                if (settings.hasOwnProperty(key)) {
                    if (key == "checkEveryXMinutes") {
                        obj[key] = Number(settings[key]);
                    }
                    else if (key === "notifyChanges" || key === "notifyConflicts") {
                        obj[key] = Boolean(settings[key]);
                    }
                    else {
                        obj[key] = settings[key];
                    }
                }
                return obj;
            }, {} as FitStorage);
        this.storage = settingsObj
    }

    // allow saving of local stores property, passed in properties will override existing stored value
    async saveSettings() {
        const data = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        // const data = Object.assign({}, DEFAULT_SETTINGS, this.storage);
        const result: FitStorage = { ...data, ...this.storage }

        await this.saveData(result);

        const excludes = this.getExcludes()

        // sync settings to Fit class as well upon saving
        for (let i in this.fits) {
            let repo = structuredClone(this.storage.repo[i])

            for (let exclude of excludes) {
                if (exclude === repo.settings.syncPath)
                    continue

                repo.settings.excludes.push(exclude)
            }

            this.fits[i].loadSettings(repo)
        }

        // update auto sync interval with new setting
        this.startOrUpdateAutoSyncInterval();
    }

    getExcludes(): string[] {
        const excludes = []
        for (let repo of this.storage.repo) {
            const path = repo.settings.syncPath
            if (path)
                excludes.push(path)
        }

        return excludes
    }

}

class FileNameView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() {
        return 'file-name-view';
    }

    getDisplayText() {
        return 'Имя файла';
    }

    getIcon() {
        return 'document';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();

        // Создаем контейнер для содержимого
        this.contentEl = container.createDiv('file-name-content');
        this.contentEl.setText('Нажмите на иконку в ribbon для отображения имени файла');
    }

    async onClose() {
        // Очищаем при закрытии
        if (this.contentEl) {
            this.contentEl.empty();
        }
    }

    // Метод для обновления содержимого
    updateContent(fileName: string, filePath: string) {
        if (this.contentEl) {
            this.contentEl.empty();

            // Добавляем информацию о файле
            this.contentEl.createEl('h2', { text: 'Информация о файле' });
            this.contentEl.createEl('p', { text: `Имя файла: ${fileName}` });
            this.contentEl.createEl('p', { text: `Путь: ${filePath}` });
            this.contentEl.createEl('p', {
                text: 'Это view создано плагином',
                cls: 'file-name-description'
            });
        }
    }
}
