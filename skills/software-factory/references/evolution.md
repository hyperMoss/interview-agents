# 证据与晋升

项目验收清单示例（字段为脚本协议，不是运行证明）：

```json
{"schemaVersion":1,"projectId":"my-app","sourceRevision":"40到64位源码摘要","status":"completed","specPath":"app.spec.yaml","checks":[{"id":"CANCEL_LATE_RESULT","result":"passed","artifact":"evidence/cancel-test.json"}]}
```

先在项目实际源码版本运行回归，产物保存到项目内并脱敏。sourceRevision 使用实际 Git commit 或源码 SHA256。填写清单；`learn-record --file <清单> --project <项目根>` 校验 spec 项目 ID、路径归属与产物哈希，写入不可覆盖的记录。它核验材料一致性，不能证明作者没有伪造测试结果；审查者必须核对实际回归输出和执行记录。

候选规则 JSON：id、lesson、capability、requiredCheck、recordIds。至少两个不同项目的记录包含该能力并通过相同 requiredCheck，才允许 `learn-propose --file <候选>`。使用合成 fixture 验证机制时明确标记为合成验收，不算真实交付经验。

晋升前重跑两个项目，准备 replay.json 数组，每项含 projectDir、manifestPath。审查可执行回归、适用边界与规则措辞，随后 `learn-promote --id <候选ID> --reviewer <真实审查者或授权流程> --file replay.json`。全套回放不得有失败；产物重新读取并核对。reviewer 是审计记录，不代表脚本认证了审查者身份。

`learn-status` 查询生效规则；`learn-rollback --version <历史目标> --reviewer <审查者>` 创建新版本恢复旧规则。历史不删除，已有项目不被静默升级。生成 `docs --learning-version <版本>` 后审查 diff，运行项目回归，再更新版本锁。

优先将经验落实到类型、schema、解析器、模板或可执行检查。指导文本可以先晋升，但它改变的是后续开发上下文，不能声称自动提高模型能力或自动修改已完成项目。网页、聊天和 Provider 结果不能直接写入生效指令；新材料先作为脱敏证据，由明确的候选与晋升命令处理。
