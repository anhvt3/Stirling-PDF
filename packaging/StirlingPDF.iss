; Inno Setup script — wraps the jpackage app-image into a real Windows installer.
; Per-user install (no admin prompt); registers in Settings > Apps with an uninstaller.

#define MyAppName "Stirling-PDF (Clevai)"
#define MyAppVersion "2.11.0"
#define MyAppPublisher "Clevai"
#define MyAppExeName "Stirling-PDF.exe"

[Setup]
AppId={{C1E7A4F2-9B3D-4E61-8A55-1A2B3C4D5E6F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Stirling-PDF
DefaultGroupName=Stirling-PDF
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
OutputDir=installer
OutputBaseFilename=Stirling-PDF-Setup-{#MyAppVersion}
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "appimage2\Stirling-PDF\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Stirling-PDF"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall Stirling-PDF"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Stirling-PDF"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch Stirling-PDF now"; Flags: nowait postinstall skipifsilent
