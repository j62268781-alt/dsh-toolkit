import React from 'react'

// The bundle compiles JSX to `__dshReact.createElement`; keep the runtime on the
// global the esbuild JSX factory resolves to (same pattern as judgment/boot).
globalThis.__dshReact = React

export default React
