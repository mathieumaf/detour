// Lets plain TypeScript tooling (ESLint) resolve `import App from './App.vue'`.
// vue-tsc reads the real component types and ignores this.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent;
  export default component;
}
