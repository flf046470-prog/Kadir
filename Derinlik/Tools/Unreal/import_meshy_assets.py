"""
Import Meshy outputs (SourceArt/Meshy/<Name>/) into the DERINLIK Unreal project.

Run inside Unreal Editor:  Tools > Execute Python Script...  -> pick this file
(or Output Log, "Python" mode:  py "<project>/Tools/Unreal/import_meshy_assets.py")
Requires the Python Editor Script Plugin (enabled in Derinlik.uproject).

For each finished asset it:
  1. imports model.fbx as a static mesh into /Game/Derinlik/Environment/Sakarya/Props/<Name>
  2. imports the PBR textures with correct settings (sRGB only on base color, normal-map
     compression, 2048 max size for the 8 GB RAM machine)
  3. if /Game/Derinlik/Materials/M_MeshyPBR exists, creates MI_<Name> from it and assigns it.
"""
import json
import os

import unreal

PROPS_ROOT = "/Game/Derinlik/Environment/Sakarya/Props"
MASTER_MATERIAL = "/Game/Derinlik/Materials/M_MeshyPBR"
MAX_TEXTURE_SIZE = 2048
# texture file suffix -> (material parameter, sRGB, compression)
TEXTURE_CHANNELS = {
    "base_color": ("BaseColor", True, unreal.TextureCompressionSettings.TC_DEFAULT),
    "normal": ("Normal", False, unreal.TextureCompressionSettings.TC_NORMALMAP),
    "roughness": ("Roughness", False, unreal.TextureCompressionSettings.TC_MASKS),
    "metallic": ("Metallic", False, unreal.TextureCompressionSettings.TC_MASKS),
}

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()


def project_dir():
    return unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())


def make_task(filename, destination, name, options=None):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", filename)
    task.set_editor_property("destination_path", destination)
    task.set_editor_property("destination_name", name)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    if options is not None:
        task.set_editor_property("options", options)
    return task


def fbx_options():
    # Ignored when the Interchange FBX importer is active; its defaults also import a static mesh.
    options = unreal.FbxImportUI()
    options.set_editor_property("import_mesh", True)
    options.set_editor_property("import_as_skeletal", False)
    options.set_editor_property("import_materials", False)
    options.set_editor_property("import_textures", False)
    mesh_data = options.get_editor_property("static_mesh_import_data")
    mesh_data.set_editor_property("combine_meshes", True)
    mesh_data.set_editor_property("auto_generate_collision", True)
    return options


def first_of_class(paths, cls):
    for path in paths:
        asset = unreal.load_asset(path)
        if isinstance(asset, cls):
            return asset
    return None


def import_asset(source_dir, name):
    destination = f"{PROPS_ROOT}/{name}"
    fbx = os.path.join(source_dir, "model.fbx")
    mesh_task = make_task(fbx, destination, name, fbx_options())
    asset_tools.import_asset_tasks([mesh_task])
    mesh = first_of_class(mesh_task.get_editor_property("imported_object_paths"), unreal.StaticMesh)
    if mesh is None:
        unreal.log_error(f"[Meshy] {name}: FBX import produced no static mesh ({fbx})")
        return False

    textures = {}
    tex_dir = os.path.join(source_dir, "textures")
    for channel, (param, srgb, compression) in TEXTURE_CHANNELS.items():
        png = os.path.join(tex_dir, f"T_{name}_{channel}.png")
        if not os.path.isfile(png):
            continue
        tex_task = make_task(png, f"{destination}/Textures", f"T_{name}_{param}")
        asset_tools.import_asset_tasks([tex_task])
        texture = first_of_class(tex_task.get_editor_property("imported_object_paths"), unreal.Texture2D)
        if texture is None:
            unreal.log_warning(f"[Meshy] {name}: could not import {png}")
            continue
        texture.set_editor_property("srgb", srgb)
        texture.set_editor_property("compression_settings", compression)
        texture.set_editor_property("max_texture_size", MAX_TEXTURE_SIZE)
        unreal.EditorAssetLibrary.save_loaded_asset(texture)
        textures[param] = texture

    master = unreal.load_asset(MASTER_MATERIAL) if unreal.EditorAssetLibrary.does_asset_exist(MASTER_MATERIAL) else None
    if master is None:
        unreal.log_warning(f"[Meshy] {name}: {MASTER_MATERIAL} not found, skipped material (see Docs/Meshy_Workflow.md)")
    else:
        mi_path = f"{destination}/MI_{name}"
        if unreal.EditorAssetLibrary.does_asset_exist(mi_path):
            mi = unreal.load_asset(mi_path)
        else:
            mi = asset_tools.create_asset(f"MI_{name}", destination, unreal.MaterialInstanceConstant,
                                          unreal.MaterialInstanceConstantFactoryNew())
        unreal.MaterialEditingLibrary.set_material_instance_parent(mi, master)
        for param, texture in textures.items():
            unreal.MaterialEditingLibrary.set_material_instance_texture_parameter_value(mi, param, texture)
        unreal.EditorAssetLibrary.save_loaded_asset(mi)
        mesh.set_material(0, mi)

    unreal.EditorAssetLibrary.save_loaded_asset(mesh)
    unreal.log(f"[Meshy] {name}: imported to {destination} ({len(textures)} textures)")
    return True


def main():
    source_root = os.path.join(project_dir(), "SourceArt", "Meshy")
    if not os.path.isdir(source_root):
        unreal.log_error(f"[Meshy] nothing to import, {source_root} does not exist")
        return
    done, failed = 0, []
    for name in sorted(os.listdir(source_root)):
        source_dir = os.path.join(source_root, name)
        state_path = os.path.join(source_dir, "task.json")
        if not os.path.isfile(state_path):
            continue
        with open(state_path, encoding="utf-8") as handle:
            state = json.load(handle)
        if state.get("status") != "DONE" or not os.path.isfile(os.path.join(source_dir, "model.fbx")):
            unreal.log_warning(f"[Meshy] {name}: not finished, skipped")
            continue
        if import_asset(source_dir, name):
            done += 1
        else:
            failed.append(name)
    unreal.log(f"[Meshy] imported {done} asset(s); failed: {failed or 'none'}")


main()
