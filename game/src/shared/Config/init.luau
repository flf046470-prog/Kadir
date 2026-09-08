--!strict
--[[
    Config aggregate for Roblox-side code.

    Pure modules never require this: they take the tables they need as parameters, which is
    what lets them run under Lune with no DataModel. This aggregate exists so adapters and
    services have one place to read from, and so ConfigValidator gets a single argument.
]]

local Config = {
    Game = require(script.GameConfig),
    Depth = require(script.DepthConfig),
    Distortion = require(script.DistortionConfig),
    Layer = require(script.LayerConfig),
    Monster = require(script.MonsterConfig),
    Item = require(script.ItemConfig),
    Fear = require(script.FearConfig),
    Flashlight = require(script.FlashlightConfig),
    Asset = require(script.AssetConfig),
    Event = require(script.EventConfig),
    Reward = require(script.RewardConfig),
    Shop = require(script.ShopConfig),
    Product = require(script.ProductConfig),
    Debug = require(script.DebugConfig),
}

return table.freeze(Config)
