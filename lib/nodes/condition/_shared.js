/**
 * _shared.js — Shared helpers for condition nodes.
 */

import { token_in_any_named_region } from "../../region_utils.js";

export function _token_in_region(bb, region_name) {
	return token_in_any_named_region(bb.token, bb.scene, region_name);
}