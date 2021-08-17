'use strict';

var electron = require('electron');
var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var win;

app.on('ready', function() {
  win = new BrowserWindow({ width: 768, height: 540 });
  win.webContents.session.clearCache(function() {
    win.webContents.session.clearStorageData({}, function() {
      win.loadURL(`file:///${__dirname}/index.html`);
    });
  });
});
