#Requires -Version 7.4
# Requires JDK 17, Android SDK platform 35 and Build Tools 35.0.0.
param(
  [string]$Jdk = $env:JAVA_HOME,
  [string]$Platform = "$env:ANDROID_HOME/platforms/android-35/android.jar",
  [string]$BuildTools = "$env:ANDROID_HOME/build-tools/35.0.0",
  [Parameter(Mandatory)][string]$Keystore
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$revision = 'ccf47536bcc47f70968ba6923c6d98f479d408f0'
if (-not (Test-Path -LiteralPath $Keystore) -or -not $env:MYDANCR_STICKER_STOREPASS) {
  throw 'Supply the release keystore and MYDANCR_STICKER_STOREPASS to sign the Android app.'
}
$build = Join-Path ([IO.Path]::GetTempPath()) ("mydancr-apk-" + [Guid]::NewGuid())
$repo = Join-Path $build 'ntag424'
$classes = Join-Path $build 'classes'
$dex = Join-Path $build 'dex'
$assets = Join-Path $build 'assets'
$tests = Join-Path $build 'tests'
$out = Join-Path $PSScriptRoot '../../public/downloads'
$null = New-Item -ItemType Directory -Path $classes,$dex,$assets,$tests
try {
  git init -q $repo
  git -C $repo fetch -q --depth=1 https://github.com/johnnyb/ntag424-java.git $revision
  git -C $repo checkout -q --detach $revision
  Copy-Item -LiteralPath "$repo/LICENSE" -Destination "$assets/ntag424-LICENSE.txt"
  $sources = (Get-ChildItem -Recurse -Path "$repo/src/main/java","$PSScriptRoot/src" -Filter '*.java').FullName
  & "$Jdk/bin/javac" --release 8 -encoding UTF-8 -cp $Platform -d $classes @sources
  & "$Jdk/bin/javac" --release 8 -encoding UTF-8 -cp $classes -d $tests "$PSScriptRoot/test/StickerChipTest.java"
  & "$Jdk/bin/java" -cp "$classes;$tests" com.mydancr.stickers.StickerChipTest
  & "$Jdk/bin/jar" cf "$build/classes.jar" -C $classes .
  & "$Jdk/bin/java" -cp "$BuildTools/lib/d8.jar" com.android.tools.r8.D8 --min-api 26 --lib $Platform --output $dex "$build/classes.jar"
  & "$BuildTools/aapt2" link -I $Platform --manifest "$PSScriptRoot/AndroidManifest.xml" -A $assets -o "$build/unsigned.apk"
  & "$Jdk/bin/jar" uf "$build/unsigned.apk" -C $dex classes.dex
  & "$BuildTools/zipalign" -f 4 "$build/unsigned.apk" "$build/aligned.apk"
  & "$Jdk/bin/java" -jar "$BuildTools/lib/apksigner.jar" sign --ks $Keystore --ks-key-alias mydancr-stickers --ks-pass env:MYDANCR_STICKER_STOREPASS --v4-signing-enabled false --out "$build/release.apk" "$build/aligned.apk"
  $verification = & "$Jdk/bin/java" -jar "$BuildTools/lib/apksigner.jar" verify --verbose --print-certs "$build/release.apk"
  if ($verification -notcontains 'Signer #1 certificate SHA-256 digest: 543a48cb4f9fdec67e9a42f836047ef5f0252bd320f1e06e3a321fa8539da486') {
    throw 'The APK signer does not match the installed MyDancr programmer.'
  }
  $verification
  $null = New-Item -ItemType Directory -Force $out
  Copy-Item -LiteralPath "$build/release.apk" -Destination "$out/mydancr-sticker-programmer.apk"
} finally {
  $resolved = [IO.Path]::GetFullPath($build)
  if ([IO.Path]::GetDirectoryName($resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and
      [IO.Path]::GetFileName($resolved) -match '^mydancr-apk-[a-f0-9-]{36}$') {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
