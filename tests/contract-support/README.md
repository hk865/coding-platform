# 测试专用构造器与替身

fixtures 保存没有生产依赖的场景构造器；testing 保存仅测试消费的模块替身。共享业务字段与守卫继续来自 src/contracts 及所属 Module。

生产宿主需要的默认样例和显式测试能力分别在 src/fixtures、src/testing；生产模块不得反向导入本目录。
