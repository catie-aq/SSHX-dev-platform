/** @file Current user and server configuration. */

import { writable } from "svelte/store";

import type { Me, PlatformConfig } from "./api";

export const me = writable<Me | null>(null);
export const config = writable<PlatformConfig | null>(null);
