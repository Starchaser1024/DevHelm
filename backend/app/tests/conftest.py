"""共享测试配置。

约定：
- 所有测试统一跑在内存 SQLite 上，避免误连开发库；`DATABASE_URL` 必须在导入 `app.*` 之前设置，
  因为 `app.core.config.settings` 是模块级单例，环境变量优先于 `.env`。
- 需要独立数据库的测试可以复用下面的 `db_session` fixture，或继续自己建 engine。
"""

import os

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base


@pytest.fixture()
def db_session():
    """内存 SQLite 会话，退出时自动释放。"""

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
