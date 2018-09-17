// Copyright (c) 2014-2018, MyMonero.com
//
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without modification, are
// permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this list of
//	conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice, this list
//	of conditions and the following disclaimer in the documentation and/or other
//	materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its contributors may be
//	used to endorse or promote products derived from this software without specific
//	prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
// EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
// THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
// PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
// STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
// THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
"use strict"
//
const EventEmitter = require('events')
const { Notification, dialog, ipcMain } = require("electron")
//
var autoUpdater;
const useMockedAutoUpdater = false && process.env.NODE_ENV === 'development'
if (useMockedAutoUpdater) { // `false &&` means don't do it even in dev mode
	const MockedUpdater = require('./MockedUpdater.electron.main.dev')
	autoUpdater = new MockedUpdater()
} else {
	autoUpdater = require("electron-updater").autoUpdater
}
autoUpdater.autoDownload = false; // No sneaking updates in if Pref has it turned off
autoUpdater.autoInstallOnAppQuit = false; // This also gets managed
//
const path = require("path")
const absPathTo_localModules = path.join(__dirname, '..')
const pathTo_iconImage_png = absPathTo_localModules + "/electron_main/Resources/icons/icon.png"
//
class Controller extends EventEmitter
{
	constructor(options, context)
	{
		super()
		const self = this
		self.options = options
		self.context = context
		//
		self.setup()
	}
	setup()
	{
		const self = this
		//
		const log = require('electron-log');
		autoUpdater.logger = log;
		autoUpdater.logger.transports.file.level = 'info';
		//
		self.set_autoUpdateInstallEnabled(false) // just to make it clear we're starting with 'off'
		// ... when the settings controller boots, we will read the value that's there.
		// that toggle will be on by default but this implementation respects the Pref before app unlock
		//
		autoUpdater.on('error', function(error)
		{
			const err_msg = error 
				? "" + error.message
				: "An unknown error occurred while checking for updates.";
			if (self.lastCheckWasManuallyInitiated) { 
				// only show dialog for error if auto-updates are off OR self.lastCheckWasManuallyInitiated == true
				dialog.showErrorBox("MyMonero Software Update Error", err_msg);
			} else {
				const note = new Notification({
					title: "Error fetching MyMonero updates",
					body: err_msg,
				})
				note.show()
			}
			self.__didFinishUpdatesCheck() // clean up state and emit
		})
		autoUpdater.on('update-available', function()
		{
			if (autoUpdater.autoDownload) {
				if (self.lastCheckWasManuallyInitiated) { 
					const note = new Notification({
						title: "Downloading Update",
						body: "MyMonero is downloading an update that it found.",
					})
					note.show()
				} else {
					// no need to say anything yet - we will do later
				}
			} else {
				dialog.showMessageBox({
					type: 'info',
					title: 'Found Update',
					icon: pathTo_iconImage_png,
					cancelId: 1,
					defaultId: 0,
					message: 'MyMonero found a software update. Do you want to download it now?',
					buttons: ['Download', 'Cancel']
				}, function(buttonIndex)
				{
					if (buttonIndex === 0) {
						autoUpdater.downloadUpdate()
					} else {
						self.__didFinishUpdatesCheck() // clean up state and emit
					}
				})
			}
		})
		autoUpdater.on('update-not-available', function()
		{
			if (self.lastCheckWasManuallyInitiated == true) {
				dialog.showMessageBox({
					title: 'No Update Available',
					icon: pathTo_iconImage_png,
					message: 'Current version is up-to-date.'
				})
			}
			self.__didFinishUpdatesCheck() // clean up state and emit
		})
		autoUpdater.on('update-downloaded', function(event, releaseNotes, releaseName)
		{
			if (autoUpdater.autoDownload && self.lastCheckWasManuallyInitiated != true) {
				if (autoUpdater.autoInstallOnAppQuit != true) {
					console.warn("Unexpected autoUpdater.autoDownload && !autoUpdater.autoInstallOnAppQuit")
				}
				if (self.lastCheckWasManuallyInitiated == true) {
					throw "This should be a dialog"
				}
				const note = new Notification({
					title: "A new update is ready to install",
					body: `New MyMonero version is downloaded and will be automatically installed on exit`,
				})
				note.show()
			} else {
				// This dialog was initially for non-autodownload, but the copy 
				// should remain compatible with self.lastCheckWasManuallyInitiated == true 
				// as well, i.e. 'the app must quit' rather than 'will install automatically 
				// on quit' (... which is mediated by autoUpdater.autoInstallOnAppQuit)
				const cancelButtonTitle = 'Later'
				const defaultButtonTitle = 'Install'
				const releaseNotesButtonTitle = 'Release Notes'
				const buttonTitles = [ defaultButtonTitle, cancelButtonTitle, releaseNotesButtonTitle ]
				const defaultButtonIndex = buttonTitles.indexOf(defaultButtonTitle)
				const cancelButtonIndex = buttonTitles.indexOf(cancelButtonTitle)
				const releaseNotesButtonTitleIndex = buttonTitles.indexOf(releaseNotesButtonTitle)
				dialog.showMessageBox({
					type: 'info',
					title: 'Updates Ready to Install',
					message: 'The new MyMonero version has been downloaded. The app must quit to install the update.',
					icon: pathTo_iconImage_png,
					defaultId: defaultButtonIndex,
					cancelId: cancelButtonIndex,
					buttons: buttonTitles,
				}, function(response) {
					if (response === defaultButtonIndex) {
						setImmediate(function()
						{
							autoUpdater.quitAndInstall()
						})
					} else if (response === releaseNotesButtonTitleIndex) {
						setImmediate(function()
						{
							const shell = require('electron').shell
							shell.openExternal(
								"https://github.com/mymonero/mymonero-app-js/releases"
							)
						})
					} else {
					}
				})
				self.__didFinishUpdatesCheck() // clean up state and emit
			}
		})
		function _observedReady()
		{
			const autoCheck = function()
			{
				if (typeof self.lastManuallyCheckInitiationDate !== 'undefined' && self.lastManuallyCheckInitiationDate) {
					const sSinceLastManualCheck = ((new Date() - self.lastManuallyCheckInitiationDate)/1000);
					if (sSinceLastManualCheck < 60 * 5) { // 5 mins
						console.warn("Skipping checking for updates since last check was manually initiated less than 5 mins ago.")
						return
					} // otherwise we'll get an immediate check for update after the user goes through the dialogs from an update check, if the user hits 'check' right after launching the app
				}
				self.checkForUpdates(false)
			}
			setTimeout(function()
			{
				autoCheck()
			}, 1000 * 10) // 10s later - after the UI has loaded and after the PW has been entered 
			setInterval(function()
			{ 
				autoCheck()
			}, 1000 * 60 * 10) // every 10 mins
		}
		if (self.context.app.isReady()) {
			_observedReady()
		} else {
			self.context.app.on('ready', _observedReady);
		}
		//
		self.startObserving_ipc()
	}
	startObserving_ipc()
	{
		const self = this
		ipcMain.on(
			self.IPCMethod__ViewOfSettingsUpdated(), 
			function(event, params)
			{
				const autoInstallUpdateEnabled = params.autoInstallUpdateEnabled
				// Called on SettingsController boot and on field toggles.
				// This will also get called on a DeleteEverything.
				// When app gets locked down we don't need to set autoupdate to off because if it's set to on, it's ok to allow autoupdate even if the app is locked
				self.set_autoUpdateInstallEnabled(autoInstallUpdateEnabled)
			}
		);
	}
	//
	// Runtime - Accessors - IPC Method names
	IPCMethod__ViewOfSettingsUpdated()
	{ 
		return "IPCMethod__ViewOfSettingsUpdated"
	}
	//
	// Imperatives
	set_autoUpdateInstallEnabled(to_isEnabled)
	{
		const self = this
		autoUpdater.autoDownload = to_isEnabled;
		autoUpdater.autoInstallOnAppQuit = to_isEnabled;
		// These get picked up by the autoUpdater again when its checkForUpdates() is called
	}
	//
	manually_checkForUpdates()
	{
		return this.checkForUpdates(true);
	}
	checkForUpdates(isManuallyInitiated)
	{
		const self = this
		{ 
			isManuallyInitiated = isManuallyInitiated == true ? true : false
		}
		if (isManuallyInitiated) { // always flip current state to true for redundant calls
			self.lastCheckWasManuallyInitiated = true
			self.lastManuallyCheckInitiationDate = new Date()
		}
		autoUpdater.checkForUpdates();
	}
	//
	// Runtime - Delegation
	__didFinishUpdatesCheck()
	{
		const self = this
		const wasManual = self.lastCheckWasManuallyInitiated
		self.lastCheckWasManuallyInitiated = undefined // un-set for next time
	}
}
module.exports = Controller
