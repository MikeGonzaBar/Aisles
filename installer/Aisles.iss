#define AppName "Aisles"
#define AppPublisher "Aisles"

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

#ifndef SourceDir
  #error SourceDir must point to the published application folder.
#endif

#ifndef OutputDir
  #error OutputDir must point to the installer output folder.
#endif

[Setup]
AppId={{F0720F65-FD2B-4D2B-84B7-80704E86D760}
AppName={#AppName}
AppPublisher={#AppPublisher}
AppVersion={#AppVersion}
DefaultDirName={autopf}\Aisles
DefaultGroupName=Aisles
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=Aisles-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\Aisles.exe

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Aisles"; Filename: "{app}\Aisles.exe"
Name: "{autodesktop}\Aisles"; Filename: "{app}\Aisles.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\Aisles.exe"; Description: "Launch Aisles"; Flags: nowait postinstall skipifsilent
