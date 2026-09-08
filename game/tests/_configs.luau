--!strict
-- Assembles the real config set the way the server does, but with direct requires so Lune
-- can load it. `Config/init.luau` uses `script.X`, which only resolves inside Roblox.

return {
    Game = require("../src/shared/Config/GameConfig"),
    Depth = require("../src/shared/Config/DepthConfig"),
    Distortion = require("../src/shared/Config/DistortionConfig"),
    Layer = require("../src/shared/Config/LayerConfig"),
    Monster = require("../src/shared/Config/MonsterConfig"),
    Item = require("../src/shared/Config/ItemConfig"),
    Fear = require("../src/shared/Config/FearConfig"),
    Flashlight = require("../src/shared/Config/FlashlightConfig"),
    Asset = require("../src/shared/Config/AssetConfig"),
    Event = require("../src/shared/Config/EventConfig"),
    Reward = require("../src/shared/Config/RewardConfig"),
    Shop = require("../src/shared/Config/ShopConfig"),
    Product = require("../src/shared/Config/ProductConfig"),
    Debug = require("../src/shared/Config/DebugConfig"),
}
