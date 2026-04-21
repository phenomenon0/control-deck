// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MacOSAXHelper",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "macos-ax-helper", targets: ["MacOSAXHelper"]),
    ],
    targets: [
        .executableTarget(
            name: "MacOSAXHelper",
            path: "Sources/MacOSAXHelper"
        ),
    ]
)
