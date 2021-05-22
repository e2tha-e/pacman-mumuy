'use strict';

const {app, BrowserWindow} = require('electron');
let win;

app.on('ready', function () {
  win = new BrowserWindow({width: 768, height: 540});
  win.loadURL(`file:///${__dirname}/index.html`);
});
