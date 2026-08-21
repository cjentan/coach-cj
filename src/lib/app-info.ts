/**
 * Central app identity + version info.
 *
 * `APP_VERSION` is read from package.json so there is exactly one source of
 * truth for the version — bump `package.json#version` on each release (and add
 * a matching entry to CHANGELOG.md).
 */
import pkg from "../../package.json";

export const APP_NAME = "Coach"; // matches the navbar brand
export const APP_VERSION = pkg.version;
