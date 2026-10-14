import { readApiConfig, readAgentConfig, readWorkerConfig } from '../packages/config/src/index';
import type { InterviewInput } from '../packages/contracts/src/index';
export const input:InterviewInput={role:'Web 全栈工程师',level:'mid',resume:'负责 React 与 NestJS 应用、数据库设计、任务队列和权限校验，并为关键功能编写自动化测试。',jobDescription:'熟悉 TypeScript、React、Node.js、PostgreSQL 与性能诊断，能够解释技术决策并进行跨团队协作。',questionCount:3,focus:''};
export const answer='我负责接口与任务队列，先通过日志定位瓶颈，再比较同步处理与异步方案，用测试和指标验证结果。最终把耗时任务从请求线程中分离，并通过状态查询和幂等机制避免重复提交。';
export const baseSpec={schema_version:'1',project:{id:'sample-app',display_name:'测试应用'},blueprint:'saas-basic',business:{summary:'用于验证按需求装配的业务应用。',roles:['owner'],requirements:[{id:'REQ-001',statement:'用户只能访问自己的资源。',acceptance:'另一用户访问相同资源时被拒绝。',capabilities:['core.platform']}],out_of_scope:[]},capabilities:{},providers:{},options:{},policy:{}};
export const apiConfig=()=>readApiConfig();export const agentConfig=()=>readAgentConfig();export const workerConfig=()=>readWorkerConfig();
