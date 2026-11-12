// Host-only entry for the external ds-harness-remote plugin.
//
// The bundle mounts ds-harness-remote through this shim instead of pointing a
// loader row straight at the npm package. The dsh client-module system scans
// every loader row's package manifest for a `dsh.client` declaration; pointing
// the row at `ds-harness-remote` would therefore also mount its own sidebar
// entry and settings pages next to the unified "远程连接" popup in this
// bundle. Re-exporting the host faces through a manifest without `dsh.client`
// keeps the pairing/Bridge host runtime (control route, settings binding,
// device identity) while leaving the browser UI to this bundle alone.
//
// Keep this file dependency-free beyond the re-export: it runs inside the DSH
// profile scope, where bare specifiers resolve through the toolkit bundle's
// dependency closure.

export { Config, apply, name } from 'ds-harness-remote'
