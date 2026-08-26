/* 注册 node-ts-hooks.mjs(Node 22+ 原生 TS 冒烟运行器入口) */
import { register } from 'node:module';
register('./node-ts-hooks.mjs', import.meta.url);
