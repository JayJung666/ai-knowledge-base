import pytest
from app.tf_classifier import is_valid_query

def test_valid_query():
    assert is_valid_query("Apa itu Machine Learning?") is True
    assert is_valid_query("RAG ChromaDB FastAPI") is True
    assert is_valid_query("123") is True

def test_invalid_query_empty():
    assert is_valid_query("") is False
    assert is_valid_query("   ") is False
    assert is_valid_query(None) is False

def test_invalid_query_too_short():
    assert is_valid_query("a") is False
    assert is_valid_query("hi") is False

def test_invalid_query_symbols_only():
    assert is_valid_query("???") is False
    assert is_valid_query("!@#$%^&*") is False
    assert is_valid_query("   ---   ") is False
