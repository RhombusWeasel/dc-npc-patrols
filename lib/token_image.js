/**
 * token_image.js — Token texture helpers for BT nodes.
 */

export function get_token_texture_src(token_doc, actor) {
	return token_doc?.texture?.src
		|| actor?.prototypeToken?.texture?.src
		|| "";
}

export function store_original_texture(bb, token_doc, actor) {
	if (bb._original_image) return;
	const src = get_token_texture_src(token_doc, actor);
	if (src) bb._original_image = src;
}

export async function set_token_texture(token_doc, image_path) {
	const path = (image_path || "").trim();
	if (!path || !token_doc) return false;
	await token_doc.update({ "texture.src": path });
	return true;
}

export async function restore_token_texture(bb, token_doc, actor) {
	const src = bb._original_image || actor?.prototypeToken?.texture?.src;
	if (!src || !token_doc) return false;
	await token_doc.update({ "texture.src": src });
	bb._original_image = null;
	return true;
}

export function get_token_image_mode_options() {
	return {
		set: "Set Image",
		restore: "Restore Original",
		prototype: "Use Prototype Token",
	};
}
