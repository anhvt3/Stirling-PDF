; Inno Setup script — wraps the jpackage app-image into a real Windows installer.
; Per-user install (no admin prompt); registers in Settings > Apps with an uninstaller.

#define MyAppName "PDFMagic"
#define MyAppVersion "2.11.0"
#define MyAppPublisher "Clevai"
#define MyAppExeName "PDFMagic.exe"

[Setup]
AppId={{C1E7A4F2-9B3D-4E61-8A55-1A2B3C4D5E6F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\PDFMagic
DefaultGroupName=PDFMagic
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
OutputDir=installer
OutputBaseFilename=PDFMagic-Setup-{#MyAppVersion}
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "appimage2\PDFMagic\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\PDFMagic"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall PDFMagic"; Filename: "{uninstallexe}"
Name: "{autodesktop}\PDFMagic"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch PDFMagic now"; Flags: nowait postinstall skipifsilent
