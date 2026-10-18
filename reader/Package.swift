// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "macviz",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "macviz",
            path: "Sources/macviz",
            linkerSettings: [.linkedFramework("IOKit"), .linkedFramework("Network")]
        ),
    ],
    swiftLanguageModes: [.v5]
)
