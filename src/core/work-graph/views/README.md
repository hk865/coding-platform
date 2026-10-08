# views：WorkGraph 的读模型子模块（L7，DESIGN §7.2；在 docs/refactor/module-target.json 声明，编排 B0）
只读：这里的代码只读取和组装记录，不写记录，也不做状态迁移。
编排第 3 片（上下文与图读取）和第 5 片（决定队列、冲突提示、请知悉）在这里建文件。
