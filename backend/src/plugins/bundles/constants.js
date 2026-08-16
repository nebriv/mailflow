// Identifiers shared across the plugin's modules.
//
// Its own file rather than a re-export from index.js: index.js imports nearly every other module to
// assemble the manifest, so anything importing the id from there would form a cycle.
export const PLUGIN_ID = 'bundles';

// Namespace for this plugin's per-message annotations (messages.plugin_annotations -> 'bundles').
// Core scopes annotation reads and writes by plugin id, so this is the same string; naming it
// separately documents that the annotation namespace is a deliberate contract with stored data,
// not an incidental reuse of the manifest id.
export const ANNOTATION_NS = PLUGIN_ID;
