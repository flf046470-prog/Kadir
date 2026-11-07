"""Generates ios/Antarktika.xcodeproj/project.pbxproj (deterministic IDs).

The Game/ folder is added as a folder reference (blue folder) so every file in
it — index.html, js/, models/ — is copied into the app bundle as Game/… and
served offline by GameAssetSchemeHandler. Run after adding Swift files:

    python3 tools/gen_xcodeproj.py
"""
import hashlib
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ios"))
NAME = "Antarktika"
BUNDLE_ID = "com.yourcompany.antarktika-whiteout"   # change to your own App ID before archiving
SWIFT = ["AntarktikaApp.swift", "GameView.swift", "GameAssetSchemeHandler.swift", "SaveStore.swift"]
RESOURCES = [("Assets.xcassets", "folder.assetcatalog"), ("Game", "folder"), ("PrivacyInfo.xcprivacy", "text.xml")]


def uid(*parts):
    return hashlib.md5("/".join(parts).encode()).hexdigest()[:24].upper()


P = uid("project")
T = uid("target")
MAIN_GROUP, APP_GROUP, PRODUCTS = uid("group", "main"), uid("group", "app"), uid("group", "products")
PRODUCT = uid("product")
SRC_PHASE, RES_PHASE, FW_PHASE = uid("phase", "src"), uid("phase", "res"), uid("phase", "fw")
PCL, TCL = uid("cl", "project"), uid("cl", "target")
PD, PR, TD, TR = uid("cfg", "pd"), uid("cfg", "pr"), uid("cfg", "td"), uid("cfg", "tr")
INFO = uid("file", "Info.plist")

files = {f: uid("file", f) for f in SWIFT}
files.update({f: uid("file", f) for f, _ in RESOURCES})
builds = {f: uid("build", f) for f in list(files)}

common_target = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "DEVELOPMENT_TEAM": '""',
    "ENABLE_PREVIEWS": "NO",
    "GENERATE_INFOPLIST_FILE": "YES",
    "INFOPLIST_FILE": f"{NAME}/Info.plist",
    "INFOPLIST_KEY_UIApplicationSceneManifest_Generation": "YES",
    "INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents": "YES",
    "IPHONEOS_DEPLOYMENT_TARGET": "16.0",
    "LD_RUNPATH_SEARCH_PATHS": '("$(inherited)", "@executable_path/Frameworks")',
    "MARKETING_VERSION": "1.0.0",
    "PRODUCT_BUNDLE_IDENTIFIER": f'"{BUNDLE_ID}"',
    "PRODUCT_NAME": '"$(TARGET_NAME)"',
    "SDKROOT": "iphoneos",
    "SUPPORTED_PLATFORMS": '"iphoneos iphonesimulator"',
    "SUPPORTS_MACCATALYST": "NO",
    "SWIFT_EMIT_LOC_STRINGS": "YES",
    "SWIFT_VERSION": "5.0",
    "TARGETED_DEVICE_FAMILY": "1",
}
common_project = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "COPY_PHASE_STRIP": "NO",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES",
    "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
    "GCC_C_LANGUAGE_STANDARD": "gnu17",
    "IPHONEOS_DEPLOYMENT_TARGET": "16.0",
    "SDKROOT": "iphoneos",
}


def settings(d, indent):
    pad = "\t" * indent
    return "".join(f"{pad}{k} = {v};\n" for k, v in sorted(d.items()))


def cfg(id_, name, s):
    return f"\t\t{id_} /* {name} */ = {{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {{\n{settings(s, 4)}\t\t\t}};\n\t\t\tname = {name};\n\t\t}};\n"


out = ["// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n\n"]
out.append("/* Begin PBXBuildFile section */\n")
for f in SWIFT:
    out.append(f"\t\t{builds[f]} /* {f} in Sources */ = {{isa = PBXBuildFile; fileRef = {files[f]} /* {f} */; }};\n")
for f, _ in RESOURCES:
    out.append(f"\t\t{builds[f]} /* {f} in Resources */ = {{isa = PBXBuildFile; fileRef = {files[f]} /* {f} */; }};\n")
out.append("/* End PBXBuildFile section */\n\n/* Begin PBXFileReference section */\n")
out.append(f"\t\t{PRODUCT} /* {NAME}.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = {NAME}.app; sourceTree = BUILT_PRODUCTS_DIR; }};\n")
for f in SWIFT:
    out.append(f"\t\t{files[f]} /* {f} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {f}; sourceTree = \"<group>\"; }};\n")
for f, kind in RESOURCES:
    out.append(f"\t\t{files[f]} /* {f} */ = {{isa = PBXFileReference; lastKnownFileType = {kind}; path = {f}; sourceTree = \"<group>\"; }};\n")
out.append(f"\t\t{INFO} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = \"<group>\"; }};\n")
out.append("/* End PBXFileReference section */\n\n/* Begin PBXFrameworksBuildPhase section */\n")
out.append(f"\t\t{FW_PHASE} /* Frameworks */ = {{\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
out.append("/* End PBXFrameworksBuildPhase section */\n\n/* Begin PBXGroup section */\n")
out.append(f"\t\t{MAIN_GROUP} = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t{APP_GROUP} /* {NAME} */,\n\t\t\t\t{PRODUCTS} /* Products */,\n\t\t\t);\n\t\t\tsourceTree = \"<group>\";\n\t\t}};\n")
kids = "".join(f"\t\t\t\t{files[f]} /* {f} */,\n" for f in SWIFT + [r for r, _ in RESOURCES]) + f"\t\t\t\t{INFO} /* Info.plist */,\n"
out.append(f"\t\t{APP_GROUP} /* {NAME} */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n{kids}\t\t\t);\n\t\t\tpath = {NAME};\n\t\t\tsourceTree = \"<group>\";\n\t\t}};\n")
out.append(f"\t\t{PRODUCTS} /* Products */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t{PRODUCT} /* {NAME}.app */,\n\t\t\t);\n\t\t\tname = Products;\n\t\t\tsourceTree = \"<group>\";\n\t\t}};\n")
out.append("/* End PBXGroup section */\n\n/* Begin PBXNativeTarget section */\n")
out.append(f"\t\t{T} /* {NAME} */ = {{\n\t\t\tisa = PBXNativeTarget;\n\t\t\tbuildConfigurationList = {TCL} /* Build configuration list for PBXNativeTarget \"{NAME}\" */;\n\t\t\tbuildPhases = (\n\t\t\t\t{SRC_PHASE} /* Sources */,\n\t\t\t\t{FW_PHASE} /* Frameworks */,\n\t\t\t\t{RES_PHASE} /* Resources */,\n\t\t\t);\n\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n\t\t\t);\n\t\t\tname = {NAME};\n\t\t\tproductName = {NAME};\n\t\t\tproductReference = {PRODUCT} /* {NAME}.app */;\n\t\t\tproductType = \"com.apple.product-type.application\";\n\t\t}};\n")
out.append("/* End PBXNativeTarget section */\n\n/* Begin PBXProject section */\n")
out.append(f"\t\t{P} /* Project object */ = {{\n\t\t\tisa = PBXProject;\n\t\t\tattributes = {{\n\t\t\t\tBuildIndependentTargetsInParallel = 1;\n\t\t\t\tLastSwiftUpdateCheck = 1600;\n\t\t\t\tLastUpgradeCheck = 1600;\n\t\t\t\tTargetAttributes = {{\n\t\t\t\t\t{T} = {{\n\t\t\t\t\t\tCreatedOnToolsVersion = 16.0;\n\t\t\t\t\t}};\n\t\t\t\t}};\n\t\t\t}};\n\t\t\tbuildConfigurationList = {PCL} /* Build configuration list for PBXProject \"{NAME}\" */;\n\t\t\tcompatibilityVersion = \"Xcode 14.0\";\n\t\t\tdevelopmentRegion = tr;\n\t\t\thasScannedForEncodings = 0;\n\t\t\tknownRegions = (\n\t\t\t\ttr,\n\t\t\t\ten,\n\t\t\t\tBase,\n\t\t\t);\n\t\t\tmainGroup = {MAIN_GROUP};\n\t\t\tproductRefGroup = {PRODUCTS} /* Products */;\n\t\t\tprojectDirPath = \"\";\n\t\t\tprojectRoot = \"\";\n\t\t\ttargets = (\n\t\t\t\t{T} /* {NAME} */,\n\t\t\t);\n\t\t}};\n")
out.append("/* End PBXProject section */\n\n/* Begin PBXResourcesBuildPhase section */\n")
res = "".join(f"\t\t\t\t{builds[f]} /* {f} in Resources */,\n" for f, _ in RESOURCES)
out.append(f"\t\t{RES_PHASE} /* Resources */ = {{\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n{res}\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
out.append("/* End PBXResourcesBuildPhase section */\n\n/* Begin PBXSourcesBuildPhase section */\n")
src = "".join(f"\t\t\t\t{builds[f]} /* {f} in Sources */,\n" for f in SWIFT)
out.append(f"\t\t{SRC_PHASE} /* Sources */ = {{\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n{src}\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
out.append("/* End PBXSourcesBuildPhase section */\n\n/* Begin XCBuildConfiguration section */\n")
out.append(cfg(PD, "Debug", {**common_project, "DEBUG_INFORMATION_FORMAT": "dwarf", "ENABLE_TESTABILITY": "YES", "GCC_OPTIMIZATION_LEVEL": "0", "ONLY_ACTIVE_ARCH": "YES", "SWIFT_ACTIVE_COMPILATION_CONDITIONS": '"DEBUG $(inherited)"', "SWIFT_OPTIMIZATION_LEVEL": '"-Onone"'}))
out.append(cfg(PR, "Release", {**common_project, "DEBUG_INFORMATION_FORMAT": '"dwarf-with-dsym"', "ENABLE_NS_ASSERTIONS": "NO", "SWIFT_COMPILATION_MODE": "wholemodule", "VALIDATE_PRODUCT": "YES"}))
out.append(cfg(TD, "Debug", common_target))
out.append(cfg(TR, "Release", common_target))
out.append("/* End XCBuildConfiguration section */\n\n/* Begin XCConfigurationList section */\n")
for cl, label, a, b in ((PCL, f'PBXProject "{NAME}"', PD, PR), (TCL, f'PBXNativeTarget "{NAME}"', TD, TR)):
    out.append(f"\t\t{cl} /* Build configuration list for {label} */ = {{\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t{a} /* Debug */,\n\t\t\t\t{b} /* Release */,\n\t\t\t);\n\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t}};\n")
out.append("/* End XCConfigurationList section */\n\t};\n\trootObject = " + P + " /* Project object */;\n}\n")

proj = os.path.join(ROOT, NAME + ".xcodeproj")
os.makedirs(os.path.join(proj, "project.xcworkspace"), exist_ok=True)
with open(os.path.join(proj, "project.pbxproj"), "w", encoding="utf-8") as fh:
    fh.write("".join(out))
with open(os.path.join(proj, "project.xcworkspace", "contents.xcworkspacedata"), "w", encoding="utf-8") as fh:
    fh.write('<?xml version="1.0" encoding="UTF-8"?>\n<Workspace\n   version = "1.0">\n   <FileRef\n      location = "self:">\n   </FileRef>\n</Workspace>\n')
print("wrote", os.path.join(proj, "project.pbxproj"))
