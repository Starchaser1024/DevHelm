from __future__ import annotations

from fastapi import FastAPI
from sqlalchemy import Engine, inspect, text

from app.db.models import Base
from app.db.session import SessionLocal, engine
from app.services.code_analysis import purge_legacy_code_documents
from app.services.conversations import backfill_all_default_conversations
from app.services.rag.vector_store import delete_milvus_documents, milvus_runtime_status

_LEGACY_COLUMN_PATCHES: dict[str, tuple[tuple[str, str], ...]] = {
    "users": (
        ("role", "VARCHAR(80) DEFAULT 'owner'"),
    ),
    "repositories": (
        ("provider", "VARCHAR(80) DEFAULT 'github'"),
        ("api_base_url", "TEXT"),
        ("clone_url", "TEXT"),
        ("local_path", "TEXT"),
        ("checkout_mode", "VARCHAR(80) DEFAULT 'managed'"),
        ("github_token_encrypted", "TEXT"),
    ),
    "workflow_runs": (
        ("jobs", "JSON"),
    ),
    "code_symbols": (
        ("pr_id", "UUID"),
        ("pr_number", "INTEGER"),
    ),
    "code_relations": (
        ("pr_id", "UUID"),
        ("pr_number", "INTEGER"),
    ),
    "chat_messages": (
        ("conversation_id", "UUID"),
    ),
    "chat_sessions": (
        ("conversation_id", "UUID"),
    ),
    "agent_runs": (
        ("conversation_id", "UUID"),
    ),
    "evidence_items": (
        ("conversation_id", "UUID"),
    ),
    "thread_memories": (
        ("facts", "JSON"),
        ("tasks", "JSON"),
        ("user_preferences", "JSON"),
        ("repo_context", "JSON"),
        ("citations", "JSON"),
    ),
    "conversation_memories": (
        ("facts", "JSON"),
        ("tasks", "JSON"),
        ("user_preferences", "JSON"),
        ("repo_context", "JSON"),
        ("citations", "JSON"),
    ),
}


def ensure_schema_compatibility(bind_engine: Engine = engine) -> None:
    """Create missing tables for local quick-start and patch legacy columns.

    Production schema changes are managed via Alembic (`backend/migrations`);
    this routine keeps existing local SQLite/PostgreSQL workspaces compatible.
    """
    Base.metadata.create_all(bind=bind_engine)
    inspector = inspect(bind_engine)
    existing_tables = set(inspector.get_table_names())

    for table_name, patches in _LEGACY_COLUMN_PATCHES.items():
        if table_name not in existing_tables:
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        missing = [(col_name, col_ddl) for col_name, col_ddl in patches if col_name not in columns]
        if not missing:
            continue
        with bind_engine.begin() as connection:
            for col_name, col_ddl in missing:
                connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_ddl}"))

    if "documents" in existing_tables:
        document_columns = {column["name"] for column in inspector.get_columns("documents")}
        if "embedding" in document_columns:
            with bind_engine.begin() as connection:
                connection.execute(text("ALTER TABLE documents DROP COLUMN embedding"))


def bootstrap_application_state(app: FastAPI) -> None:
    """Ensure database compatibility, backfill default conversations, and probe Milvus."""
    ensure_schema_compatibility(engine)

    db = SessionLocal()
    try:
        backfill_all_default_conversations(db)
        if purge_legacy_code_documents(db):
            db.commit()
    finally:
        db.close()

    app.state.rag_vector_status = milvus_runtime_status()
    delete_milvus_documents(source_types=["code_file"], strict=False)
