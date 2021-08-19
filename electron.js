'use strict';

var electron = require('electron');
var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var win;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('ready', function() {
  win = new BrowserWindow({ width: 768, height: 540 });
  win.webContents.session.clearCache(function() {
    win.loadURL(`file://${__dirname}/index.html`);
  });
});
