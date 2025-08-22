import FitPlugin, { DEFAULT_REPOSITORY, SyncSetting } from "main";
import { App, PluginSettingTab, Setting } from "obsidian";
import { setEqual } from "./utils";
import { warn } from "console";

type RefreshCheckPoint = "repo(0)" | "branch(1)" | "link(2)" | "initialize" | "withCache"

export default class FitSettingTab extends PluginSettingTab {
	plugin: FitPlugin;
	// authenticating: boolean;
	authUserAvatar: HTMLDivElement;
	authUserHandle: HTMLSpanElement;
	// patSetting: Setting;
	// ownerSetting: Setting;
	// repoSetting: Setting;
	// branchSetting: Setting;
	// syncPathSetting: Setting;
	// existingRepos: Array<string>;
	// existingBranches: Array<string>;
	// repoLink: string;
	// syncPath: string;
	currentSyncIndex: number = 0;

	constructor(app: App, plugin: FitPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		// this.currentSyncIndex = plugin.settings.currentSyncIndex || 0;
		// this.repoLink = this.getLatestLink();
		// this.authenticating = false;
		// this.existingRepos = [];
		// this.existingBranches = [];
	}

	getCurrentSyncSetting(): SyncSetting {
		return this.plugin.storage.repo[this.currentSyncIndex].settings;
	}

	// getLatestLink = (): string => {
	// 	const currentSetting = this.getCurrentSyncSetting();
	// 	const {owner, repo, branch} = currentSetting;
	// 	if (owner.length > 0 && repo.length > 0 && branch.length > 0) {
	// 		return `https://github.com/${owner}/${repo}/tree/${branch}`;
	// 	}
	// 	return "";
	// }

	// handleUserFetch = async () => {
	// 	this.authenticating = true;
	// 	this.authUserAvatar.removeClass('error');
	// 	this.authUserAvatar.empty();
	// 	this.authUserAvatar.removeClass('empty');
	// 	this.authUserAvatar.addClass('cat');

	// 	const currentSetting = this.getCurrentSyncSetting();

	// 	try {
	// 		const {owner, avatarUrl} = await this.plugin.fit.getUser();
	// 		this.authUserAvatar.removeClass('cat');
	// 		this.authUserAvatar.createEl('img', { attr: { src: avatarUrl } });
	// 		this.authUserHandle.setText(owner);

	// 		if (owner !== currentSetting.owner) {
	// 			currentSetting.owner = owner;
	// 			currentSetting.avatarUrl = avatarUrl;
	// 			currentSetting.repo = "";
	// 			currentSetting.branch = "";
	// 			this.existingBranches = [];
	// 			this.existingRepos = [];
	// 			await this.plugin.saveSettings();
	// 			await this.refreshFields('repo(0)');
	// 		}
	// 		this.authenticating = false;
	// 	} catch (error) {
	// 		this.authUserAvatar.removeClass('cat');
	// 		this.authUserAvatar.addClass('error');
	// 		this.authUserHandle.setText("Authentication failed, make sure your token has not expired.");
	// 		currentSetting.owner = "";
	// 		currentSetting.avatarUrl = "";
	// 		currentSetting.repo = "";
	// 		currentSetting.branch = "";
	// 		this.existingBranches = [];
	// 		this.existingRepos = [];
	// 		await this.plugin.saveSettings();
	// 		this.refreshFields('initialize');
	// 		this.authenticating = false;
	// 	}
	// }

	githubUserInfoBlock = () => {
		const {containerEl} = this;
		const currentSetting = this.getCurrentSyncSetting();

		new Setting(containerEl).setHeading()
			.setName(`GitHub user info (Repository ${this.currentSyncIndex + 1})`)
			// .addButton(button => button
			// 	.setCta()
				// .setButtonText("Authenticate user")
				// .setDisabled(this.authenticating)
				// .onClick(async ()=>{
				// 	// if (this.authenticating) return;
				// 	await this.handleUserFetch();
				// );

		// const ownerSetting = new Setting(containerEl)
		// 	.setDesc("Input your personal access token below to get authenticated. Create a GitHub account here if you don't have one yet.")
		// 	.addExtraButton(button=>button
		// 		.setIcon('github')
		// 		.setTooltip("Sign up on github.com")
		// 		.onClick(async ()=>{
		// 			window.open("https://github.com/signup", "_blank");
		// 		}));

		// ownerSetting.nameEl.addClass('fit-avatar-container');
		// if (currentSetting.owner === "") {
		// 	this.authUserAvatar = ownerSetting.nameEl.createDiv({cls: 'fit-avatar-container empty'});
		// 	this.authUserHandle = ownerSetting.nameEl.createEl('span', {cls: 'fit-github-handle'});
		// 	this.authUserHandle.setText("Unauthenticated");
		// } else {
		// 	this.authUserAvatar = ownerSetting.nameEl.createDiv({cls: 'fit-avatar-container'});
		// 	this.authUserAvatar.createEl('img', { attr: { src: currentSetting.avatarUrl } });
		// 	this.authUserHandle = ownerSetting.nameEl.createEl('span', {cls: 'fit-github-handle'});
		// 	this.authUserHandle.setText(currentSetting.owner);
		// }

		// ownerSetting.controlEl.addClass('fit-avatar-display-text');

		new Setting(containerEl)
			.setName('Github username')
			.setDesc('Enter your name on Github')
			.addText(text => text
				.setPlaceholder('GitHub username')
				.setValue(currentSetting.owner)
				.onChange(async (value) => {
					currentSetting.pat = value;
					await this.plugin.saveSettings();
				}))

		new Setting(containerEl)
			.setName('Github personal access token')
			.setDesc('Remember to give it access for reading and writing to the storage repo.')
			.addText(text => text
				.setPlaceholder('GitHub personal access token')
				.setValue(currentSetting.pat)
				.onChange(async (value) => {
					currentSetting.pat = value;
					await this.plugin.saveSettings();
				}))
			.addExtraButton(button=>button
				.setIcon('external-link')
				.setTooltip("Create a token")
				.onClick(async ()=>{
					window.open("https://github.com/settings/tokens/new", '_blank');
				}));

		new Setting(containerEl)
			.setName('Device name')
			.setDesc('Sign commit message with this device name.')
			.addText(text => text
				.setPlaceholder('Device name')
				.setValue(currentSetting.deviceName)
				.onChange(async (value) => {
					currentSetting.deviceName = value;
					await this.plugin.saveSettings();
				}));

// export interface SyncSetting {
// 	pat: string; +
// 	owner: string; +
// 	avatarUrl: string;
// 	repo: string;
// 	branch: string;
// 	syncPath: string;
// 	deviceName: string; +
// 	excludes: string[]
// }
		// new Setting(containerEl)
		// 	.setName('Branch name')
		// 	.setDesc('Select a repo above to view existing branches.')
		// 	.addDropdown(dropdown => {
		// 		dropdown.selectEl.addClass('branch-dropdown');
		// 		dropdown.setDisabled(this.existingBranches.length === 0);
		// 		this.existingBranches.map(repo=>dropdown.addOption(repo, repo));
		// 		dropdown.setValue(currentSetting.branch);
		// 		dropdown.onChange(async (value) => {
		// 			const branchChanged = value !== currentSetting.branch;
		// 			if (branchChanged) {
		// 				currentSetting.branch = value;
		// 				await this.plugin.saveSettings();
		// 				await this.refreshFields('link(2)');
		// 			}
		// 		});
		// 	});

		// new Setting(containerEl)
		// 	.setName('Sync path')
		// 	.setDesc('Select a local path to sync with repo.')
		// 	.addText(text => {
		// 		text.setPlaceholder('Enter folder path')
		// 			.setValue(currentSetting.syncPath || '')
		// 			.onChange(async (value) => {
		// 				currentSetting.syncPath = value;
		// 				await this.plugin.saveSettings();
		// 			});

		// 		const dataList = document.createElement('datalist');
		// 		dataList.id = `folder-suggestions-${this.currentSyncIndex}`;

		// 		const folders = this.plugin.vaultOps.getFoldersInVault();
		// 		for (let folder of folders) {
		// 			const option = document.createElement('option');
		// 			option.value = folder;
		// 			dataList.appendChild(option);
		// 		}

		// 		text.inputEl.setAttribute('list', `folder-suggestions-${this.currentSyncIndex}`);
		// 		text.inputEl.parentElement?.appendChild(dataList);
		// 	});

		// this.repoLink = this.getLatestLink();
		// const linkDisplay = new Setting(containerEl)
		// 	.setName("View your vault on GitHub")
		// 	.setDesc(this.repoLink)
		// 	.addExtraButton(button => button
		// 		.setDisabled(this.repoLink.length === 0)
		// 		.setTooltip("Open on GitHub")
		// 		.setIcon('external-link')
		// 		.onClick(() => {
		// 			console.log(`opening ${this.repoLink}`);
		// 			window.open(this.repoLink, '_blank');
		// 		})
		// 	);
		// linkDisplay.descEl.addClass("link-desc");
	}

	// repoInfoBlock = async () => {
	// 	const {containerEl} = this;
	// 	const currentSetting = this.getCurrentSyncSetting();

	// 	new Setting(containerEl).setHeading().setName("Repository info")
	// 		.setDesc("Refresh to retrieve the latest list of repos and branches.")
	// 		.addExtraButton(button => button
	// 			.setTooltip("Refresh repos and branches list")
	// 			.setDisabled(currentSetting.owner === "")
	// 			.setIcon('refresh-cw')
	// 			.onClick(async () => {
	// 				await this.refreshFields('repo(0)');
	// 			}));

	// 	new Setting(containerEl)
	// 		.setDesc("Select 'Add a README file' if creating a new repo. Make sure you are logged in to github on your browser.")
	// 		.addExtraButton(button => button
	// 			.setIcon('github')
	// 			.setTooltip("Create a new repository")
	// 			.onClick(() => {
	// 				window.open(`https://github.com/new`, '_blank');
	// 			}));

	// 	this.repoSetting = new Setting(containerEl)
	// 		.setName('Github repository name')
	// 		.setDesc("Select a repo to sync your vault, refresh to see your latest repos. If some repos are missing, make sure your token are granted access to them.")
	// 		.addDropdown(dropdown => {
	// 			dropdown.selectEl.addClass('repo-dropdown');
	// 			this.existingRepos.map(repo=>dropdown.addOption(repo, repo));
	// 			dropdown.setDisabled(this.existingRepos.length === 0);
	// 			dropdown.setValue(currentSetting.repo);
	// 			dropdown.onChange(async (value) => {
	// 				const repoChanged = value !== currentSetting.repo;
	// 				if (repoChanged) {
	// 					currentSetting.repo = value;
	// 					await this.plugin.saveSettings();
	// 					await this.refreshFields('branch(1)');
	// 				}
	// 			});
	// 		});

	// }

	localConfigBlock = () => {
		const {containerEl} = this;
		// const currentSetting = this.getCurrentSyncSetting();

		new Setting(containerEl).setHeading().setName("Local configurations");

		new Setting(containerEl)
			.setName("Auto sync")
			.setDesc(`Automatically sync your vault when remote has updates. (Muted: sync in the background without displaying notices, except for file changes and conflicts notice)`)
			.addDropdown(dropdown => {
				dropdown
				.addOption('off', 'Off')
				.addOption('muted', 'Muted')
				.addOption('remind', 'Remind only')
				.addOption('on', 'On')
				.setValue(this.plugin.storage.autoSync ? this.plugin.storage.autoSync : 'off')
				.onChange(async (value) => {
					this.plugin.storage.autoSync = value as "off" | "muted" | "remind" | "on";
					checkIntervalSlider.settingEl.addClass(value === "off" ? "clear" : "restore");
					checkIntervalSlider.settingEl.removeClass(value === "off" ? "restore" : "clear");
					await this.plugin.saveSettings();
				})
			})

		const checkIntervalSlider = new Setting(containerEl)
			.setName('Auto check interval')
			.setDesc(`Automatically check for remote changes in the background every ${this.plugin.storage.checkEveryXMinutes} minutes.`)
			.addSlider(slider => slider
				.setLimits(1, 60, 1)
				.setValue(this.plugin.storage.checkEveryXMinutes)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.storage.checkEveryXMinutes = value;
					await this.plugin.saveSettings();
					checkIntervalSlider.setDesc(`Automatically check for remote changes in the background every ${value} minutes.`)
				})
			)

		if (this.plugin.storage.autoSync === "off") {
			checkIntervalSlider.settingEl.addClass("clear")
		}
	}

	noticeConfigBlock = () => {
		const {containerEl} = this;
		const selectedCol = "var(--interactive-accent)";
		const selectedTxtCol = "var(--text-on-accent)";
		const unselectedColor = "var(--interactive-normal)";
		const unselectedTxtCol = "var(--text-normal)";
		const stateTextMap = (notifyConflicts: boolean, notifyChanges: boolean) => {
			if (notifyConflicts && notifyChanges) {
				return "Displaying file changes and conflicts ";
			} else if (!notifyConflicts && notifyChanges) {
				return "Displaying file changes ";
			} else if (notifyConflicts && !notifyChanges) {
				return "Displaying change conflicts ";
			} else {
				return "No notice displayed ";
			}
		};
		const noticeDisplay = new Setting(containerEl)
			.setName("Notice display")
			.setDesc(`${stateTextMap(this.plugin.storage.notifyConflicts, this.plugin.storage.notifyChanges)} after sync.`)
			.addButton(button => {
				button.setButtonText("Change conflicts");
				button.onClick(async () => {
					const notifyConflicts = !this.plugin.storage.notifyConflicts;
					this.plugin.storage.notifyConflicts = notifyConflicts;
					await this.plugin.saveSettings();
					button.buttonEl.setCssStyles({
						"background": notifyConflicts ? selectedCol : unselectedColor,
						"color": notifyConflicts ? selectedTxtCol : unselectedTxtCol,
					});
					noticeDisplay.setDesc(`${stateTextMap(notifyConflicts, this.plugin.storage.notifyChanges)} after sync.`);
				});
				button.buttonEl.setCssStyles({
					"background": this.plugin.storage.notifyConflicts ? selectedCol : unselectedColor,
					"color": this.plugin.storage.notifyConflicts ? selectedTxtCol : unselectedTxtCol,
				});
			})
			.addButton(button => {
				button.setButtonText("File changes");
				button.onClick(async () => {
					const notifyChanges = !this.plugin.storage.notifyChanges;
					this.plugin.storage.notifyChanges = notifyChanges;
					await this.plugin.saveSettings();
					button.buttonEl.setCssStyles({
						"background": notifyChanges ? selectedCol : unselectedColor,
						"color": notifyChanges ? selectedTxtCol : unselectedTxtCol,
					});
					noticeDisplay.setDesc(`${stateTextMap(this.plugin.storage.notifyConflicts, notifyChanges)} after sync.`);
				});
				button.buttonEl.setCssStyles({
					"background": this.plugin.storage.notifyChanges ? selectedCol : unselectedColor,
					"color": this.plugin.storage.notifyChanges ? selectedTxtCol : unselectedTxtCol,
				});
			});
	}

	// refreshFields = async (refreshFrom: RefreshCheckPoint) => {
	// 	const {containerEl} = this;
	// 	const currentSetting = this.getCurrentSyncSetting();
	// 	const repo_dropdown = containerEl.querySelector('.repo-dropdown') as HTMLSelectElement;
	// 	const branch_dropdown = containerEl.querySelector('.branch-dropdown') as HTMLSelectElement;
	// 	const link_el = containerEl.querySelector('.link-desc') as HTMLElement;

	// 	if (refreshFrom === "repo(0)") {
	// 		repo_dropdown.disabled = true;
	// 		branch_dropdown.disabled = true;
	// 		this.existingRepos = await this.plugin.fit.getRepos();
	// 		const repoOptions = Array.from(repo_dropdown.options).map(option => option.value);
	// 		if (!setEqual<string>(this.existingRepos, repoOptions)) {
	// 			repo_dropdown.empty();
	// 			this.existingRepos.map(repo => {
	// 				repo_dropdown.add(new Option(repo, repo));
	// 			});
	// 			const selectedRepoIndex = this.existingRepos.indexOf(currentSetting.repo);
	// 			repo_dropdown.selectedIndex = selectedRepoIndex;
	// 			if (selectedRepoIndex === -1){
	// 				currentSetting.repo = "";
	// 			}
	// 		}
	// 		repo_dropdown.disabled = false;
	// 	}

	// 	if (refreshFrom === "branch(1)" || refreshFrom === "repo(0)") {
	// 		if (currentSetting.repo === "") {
	// 			branch_dropdown.empty();
	// 		} else {
	// 			const latestBranches = await this.plugin.fit.getBranches();
	// 			if (!setEqual<string>(this.existingBranches, latestBranches)) {
	// 				branch_dropdown.empty();
	// 				this.existingBranches = latestBranches;
	// 				this.existingBranches.map(branch => {
	// 					branch_dropdown.add(new Option(branch, branch));
	// 				});
	// 				const selectedBranchIndex = this.existingBranches.indexOf(currentSetting.branch);
	// 				branch_dropdown.selectedIndex = selectedBranchIndex;
	// 				if (selectedBranchIndex === -1){
	// 					currentSetting.branch = "";
	// 				}
	// 			}
	// 		}
	// 		branch_dropdown.disabled = false;
	// 	}

	// 	if (refreshFrom === "link(2)" || refreshFrom === "branch(1)" || refreshFrom === "repo(0)") {
	// 		this.repoLink = this.getLatestLink();
	// 		if (link_el) {
	// 			link_el.innerText = this.repoLink;
	// 		}
	// 	}

	// 	if (refreshFrom === "initialize") {
	// 		const {repo, branch} = currentSetting;
	// 		if (repo_dropdown) repo_dropdown.empty();
	// 		if (branch_dropdown) branch_dropdown.empty();
	// 		if (repo_dropdown && repo) repo_dropdown.add(new Option(repo, repo));
	// 		if (branch_dropdown && branch) branch_dropdown.add(new Option(branch, branch));
	// 		if (link_el) link_el.innerText = this.getLatestLink();
	// 	}

	// 	if (refreshFrom === "withCache") {
	// 		if (repo_dropdown) repo_dropdown.empty();
	// 		if (branch_dropdown) branch_dropdown.empty();

	// 		if (this.existingRepos.length > 0) {
	// 			this.existingRepos.map(repo => {
	// 				if (repo_dropdown) repo_dropdown.add(new Option(repo, repo));
	// 			});
	// 			if (repo_dropdown) {
	// 				repo_dropdown.selectedIndex = this.existingRepos.indexOf(currentSetting.repo);
	// 			}
	// 		}

	// 		if (this.existingBranches.length > 0) {
	// 			this.existingBranches.map(branch => {
	// 				if (branch_dropdown) branch_dropdown.add(new Option(branch, branch));
	// 			});
	// 			if (branch_dropdown) {
	// 				if (currentSetting.branch === "") {
	// 					branch_dropdown.selectedIndex = -1;
	// 				}
	// 				branch_dropdown.selectedIndex = this.existingBranches.indexOf(currentSetting.branch);
	// 			}
	// 		}

	// 		if (currentSetting.repo !== "") {
	// 			if (this.existingRepos.length === 0) {
	// 				if (repo_dropdown) repo_dropdown.add(new Option(currentSetting.repo, currentSetting.repo));
	// 			} else if (repo_dropdown) {
	// 				repo_dropdown.selectedIndex = this.existingRepos.indexOf(currentSetting.repo);
	// 				if (branch_dropdown && branch_dropdown.selectedIndex === -1) {
	// 					warn(`warning: selected branch ${currentSetting.branch} not found, existing branches: ${this.existingBranches}`);
	// 				}
	// 			}
	// 		}

	// 		if (currentSetting.branch !== "") {
	// 			if (this.existingBranches.length === 0) {
	// 				if (branch_dropdown) branch_dropdown.add(new Option(currentSetting.branch, currentSetting.branch));
	// 			} else if (branch_dropdown) {
	// 				branch_dropdown.selectedIndex = this.existingBranches.indexOf(currentSetting.branch);
	// 				if (branch_dropdown.selectedIndex === -1) {
	// 					warn(`warning: selected branch ${currentSetting.branch} not found, existing branches: ${this.existingBranches}`);
	// 				}
	// 			}
	// 		}

	// 		if (link_el) {
	// 			link_el.innerText = this.getLatestLink();
	// 		}
	// 	}
	// }

	counterRepoBlock = () => {
		const {containerEl} = this;

		new Setting(containerEl)
			.setName('Manage repositories')
			.setDesc('Add or remove repository configurations')
			.addButton(button => button
				.setButtonText('Add Repository')
				.setCta()
				.onClick(async () => {
					this.plugin.storage.repo.push(DEFAULT_REPOSITORY);
					await this.plugin.saveSettings();
					this.display();
				}))
			.addButton(button => button
				.setButtonText('Remove Repository')
				.setWarning()
				.setDisabled(this.plugin.storage.repo.length <= 1)
				.onClick(async () => {
					if (this.plugin.storage.repo.length > 1) {
						this.plugin.storage.repo.splice(this.currentSyncIndex, 1);
						if (this.currentSyncIndex >= this.plugin.storage.repo.length) {
							this.currentSyncIndex = this.plugin.storage.repo.length - 1;
						}
						await this.plugin.saveSettings();
						this.display();
					}
				}));

		new Setting(containerEl)
			.setName('Current repository')
			.setDesc('Select which repository configuration to edit')
			.addDropdown(dropdown => {
				this.plugin.storage.repo.forEach((_, index) => {
					dropdown.addOption(index.toString(), `Repository ${index + 1}`);
				});
				dropdown.setValue(this.currentSyncIndex.toString());
				dropdown.onChange(async (value) => {
					this.currentSyncIndex = parseInt(value);
					await this.plugin.saveSettings();
					this.display();
				});
			});
	}

	async display(): Promise<void> {
		const {containerEl} = this;

		containerEl.empty();


		this.localConfigBlock();
		this.noticeConfigBlock();
		containerEl.createEl('hr');

		this.counterRepoBlock();
		containerEl.createEl('hr');

		this.githubUserInfoBlock();
		// await this.repoInfoBlock();

		// this.refreshFields("withCache");
	}
}

// class FolderSuggestModal extends SuggestModal<string> {
//     constructor(app: App, private folders: string[], private callback: (folder: string) => void) {
//         super(app);
//     }

//     getSuggestions(query: string): string[] {
//         return this.folders.filter(folder =>
//             folder.toLowerCase().includes(query.toLowerCase())
//         );
//     }

//     renderSuggestion(folder: string, el: HTMLElement) {
//         el.createEl('div', { text: folder });
//     }

//     onChooseSuggestion(folder: string, evt: MouseEvent | KeyboardEvent) {
//         this.callback(folder);
//     }
// }
