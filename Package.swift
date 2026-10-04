// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "CuescordScreenAudio",
  platforms: [.macOS(.v13)],
  products: [.executable(name: "CuescordAudioCapture", targets: ["CuescordAudioCapture"])],
  targets: [
    .target(name: "CuescordProcess", path: "native/macos/process", publicHeadersPath: "include"),
    .executableTarget(
      name: "CuescordAudioCapture",
      dependencies: ["CuescordProcess"],
      path: "native/macos",
      exclude: ["process"],
      sources: ["ScreenAudio.swift"],
      linkerSettings: [
        .linkedFramework("ScreenCaptureKit"),
        .linkedFramework("AVFoundation"),
        .linkedFramework("CoreMedia"),
      ]
    ),
  ]
)
