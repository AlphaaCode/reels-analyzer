// The Windows installer. Build order: `npm run build` at the root, then here
// `npm run ffmpeg`, `npm run stage`, `npm run dist` (CONTRIBUTING.md).
// The version is the web app's (root package.json), so a release bumps one file.
const { version } = require('../package.json');

module.exports = {
    appId: 'com.alphaacode.reelsanalyzer',
    productName: 'Reels Analyzer',
    copyright: 'Copyright © 2026 Yazid Bensefia',
    extraMetadata: { version },
    directories: { output: 'dist' },
    files: ['main.js'],
    // The server, ffmpeg, licences and server-host.js, as plain files beside the app
    extraResources: [{ from: 'stage', to: '.' }],
    electronLanguages: ['en-US', 'ar'],
    win: {
        target: [{ target: 'nsis', arch: ['x64'] }],
        icon: '../src/app/icon.png'
    },
    nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: 'Reels Analyzer',
        artifactName: 'ReelsAnalyzer-Setup-${version}.${ext}',
        installerLanguages: ['en_US', 'ar_SA'],
        include: 'installer.nsh'
    },
    // Published releases (not drafts), so the update check sees them
    publish: { provider: 'github', owner: 'AlphaaCode', repo: 'reels-analyzer', releaseType: 'release' }
};
