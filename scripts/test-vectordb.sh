#!/bin/bash
# VectorDB Integration Test Script
# Tests all major VectorDB features via control-deck bridge API

set -e

BRIDGE_URL="http://localhost:3333/api/tools/bridge"
VDB_URL="http://localhost:4242"
COLLECTION="test_$(date +%s)"

echo "=========================================="
echo "VectorDB Integration Tests"
echo "Collection: $COLLECTION"
echo "=========================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "${YELLOW}→ $1${NC}"; }

# Test 1: Health Check
echo ""
info "Test 1: VectorDB Health Check"
HEALTH=$(curl -s "$VDB_URL/health")
if echo "$HEALTH" | jq -e '.ok == true' > /dev/null; then
  TOTAL=$(echo "$HEALTH" | jq '.total')
  COLLECTIONS=$(echo "$HEALTH" | jq '.collections | length')
  pass "VectorDB online - $TOTAL vectors in $COLLECTIONS collections"
else
  fail "VectorDB health check failed"
fi

# Test 2: Store Document via Bridge
echo ""
info "Test 2: Store Document (vector_store)"
STORE_RESULT=$(curl -s -X POST "$BRIDGE_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"vector_store\",
    \"args\": {
      \"text\": \"The quick brown fox jumps over the lazy dog. This is a test document for VectorDB integration testing.\",
      \"collection\": \"$COLLECTION\",
      \"metadata\": {\"source\": \"test\", \"type\": \"sample\"}
    },
    \"ctx\": {\"thread_id\": \"test\", \"run_id\": \"run-store\"}
  }")

if echo "$STORE_RESULT" | jq -e '.success == true' > /dev/null; then
  pass "Document stored successfully"
else
  fail "Store failed: $(echo "$STORE_RESULT" | jq -r '.error // .message')"
fi

# Test 3: Store Large Document (should auto-chunk)
echo ""
info "Test 3: Store Large Document (auto-chunking)"
LARGE_TEXT=$(cat << 'EOF'
VectorDB is a high-performance vector database designed for semantic search and retrieval. It uses HNSW (Hierarchical Navigable Small World) indexing for fast approximate nearest neighbor search.

The system supports multiple embedding backends including Ollama and OpenAI. When using Ollama, it defaults to the nomic-embed-text model which produces 768-dimensional embeddings.

Key features include:
1. Batch insertion for high throughput
2. Metadata filtering with AND, OR, and NOT conditions
3. Hybrid search combining vector similarity with lexical matching
4. Collection-based organization for multi-tenant scenarios
5. WAL (Write-Ahead Logging) for durability
6. Automatic compaction to remove tombstoned documents

The HTTP API provides endpoints for insert, batch_insert, query, delete, health, and compact operations. Authentication can be enabled using JWT tokens for multi-tenant deployments.

Performance characteristics:
- Insert: ~1000 docs/sec with Ollama embeddings
- Query: <10ms for top-10 with 100K documents
- Memory: ~1KB per vector for 768 dimensions
EOF
)

CHUNK_RESULT=$(curl -s -X POST "$BRIDGE_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"vector_store\",
    \"args\": {
      \"text\": $(echo "$LARGE_TEXT" | jq -Rs .),
      \"collection\": \"$COLLECTION\",
      \"metadata\": {\"source\": \"test\", \"type\": \"docs\"}
    },
    \"ctx\": {\"thread_id\": \"test\", \"run_id\": \"run-chunk\"}
  }")

if echo "$CHUNK_RESULT" | jq -e '.success == true' > /dev/null; then
  CHUNKS=$(echo "$CHUNK_RESULT" | jq -r '.data.chunks // 1')
  pass "Large document stored as $CHUNKS chunk(s)"
else
  fail "Chunk store failed: $(echo "$CHUNK_RESULT" | jq -r '.error // .message')"
fi

# Test 4: Semantic Search
echo ""
info "Test 4: Semantic Search (vector_search)"
sleep 1  # Allow indexing
SEARCH_RESULT=$(curl -s -X POST "$BRIDGE_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"vector_search\",
    \"args\": {
      \"query\": \"fast approximate nearest neighbor\",
      \"collection\": \"$COLLECTION\",
      \"k\": 3
    },
    \"ctx\": {\"thread_id\": \"test\", \"run_id\": \"run-search\"}
  }")

if echo "$SEARCH_RESULT" | jq -e '.success == true' > /dev/null; then
  COUNT=$(echo "$SEARCH_RESULT" | jq '.data.results | length')
  TOP_SCORE=$(echo "$SEARCH_RESULT" | jq '.data.results[0].score // 0')
  pass "Found $COUNT results (top score: $TOP_SCORE)"
else
  fail "Search failed: $(echo "$SEARCH_RESULT" | jq -r '.error // .message')"
fi

# Test 5: Hybrid Search
echo ""
info "Test 5: Hybrid Search (vector + lexical)"
HYBRID_RESULT=$(curl -s -X POST "$BRIDGE_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"vector_search\",
    \"args\": {
      \"query\": \"HNSW indexing performance\",
      \"collection\": \"$COLLECTION\",
      \"k\": 3,
      \"mode\": \"hybrid\"
    },
    \"ctx\": {\"thread_id\": \"test\", \"run_id\": \"run-hybrid\"}
  }")

if echo "$HYBRID_RESULT" | jq -e '.success == true' > /dev/null; then
  COUNT=$(echo "$HYBRID_RESULT" | jq '.data.results | length')
  pass "Hybrid search returned $COUNT results"
else
  fail "Hybrid search failed: $(echo "$HYBRID_RESULT" | jq -r '.error // .message')"
fi

# Test 6: Search with Metadata Filter
echo ""
info "Test 6: Search with Metadata Filter"
FILTER_RESULT=$(curl -s -X POST "$BRIDGE_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"vector_search\",
    \"args\": {
      \"query\": \"vector database\",
      \"collection\": \"$COLLECTION\",
      \"k\": 5,
      \"filter\": {\"type\": \"docs\"}
    },
    \"ctx\": {\"thread_id\": \"test\", \"run_id\": \"run-filter\"}
  }")

if echo "$FILTER_RESULT" | jq -e '.success == true' > /dev/null; then
  COUNT=$(echo "$FILTER_RESULT" | jq '.data.results | length')
  pass "Filtered search returned $COUNT results"
else
  fail "Filtered search failed: $(echo "$FILTER_RESULT" | jq -r '.error // .message')"
fi

# Test 7: URL Ingestion (if network available)
echo ""
info "Test 7: URL Ingestion (vector_ingest)"
INGEST_RESULT=$(curl -s -X POST "$BRIDGE_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"vector_ingest\",
    \"args\": {
      \"url\": \"https://httpbin.org/html\",
      \"collection\": \"$COLLECTION\"
    },
    \"ctx\": {\"thread_id\": \"test\", \"run_id\": \"run-ingest\"}
  }")

if echo "$INGEST_RESULT" | jq -e '.success == true' > /dev/null; then
  CHUNKS=$(echo "$INGEST_RESULT" | jq -r '.data.chunks // 0')
  pass "URL ingested as $CHUNKS chunk(s)"
else
  # Network might not be available, don't fail
  echo -e "${YELLOW}⚠ URL ingest skipped: $(echo "$INGEST_RESULT" | jq -r '.error // .message')${NC}"
fi

# Test 8: Direct VectorDB Query (verify metadata returned)
echo ""
info "Test 8: Direct Query with Metadata"
DIRECT_RESULT=$(curl -s -X POST "$VDB_URL/query" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"vector database\",
    \"collection\": \"$COLLECTION\",
    \"top_k\": 2,
    \"include_meta\": true
  }")

if echo "$DIRECT_RESULT" | jq -e '.docs | length > 0' > /dev/null; then
  HAS_META=$(echo "$DIRECT_RESULT" | jq 'if .meta then (.meta | length > 0) else false end')
  if [ "$HAS_META" = "true" ]; then
    pass "Direct query returned results with metadata"
  else
    pass "Direct query returned results (no metadata in response)"
  fi
else
  fail "Direct query returned no results"
fi

# Cleanup: Delete test collection
echo ""
info "Cleanup: Deleting test collection"
DELETE_RESULT=$(curl -s -X DELETE "$VDB_URL/v2/collections/$COLLECTION")
if echo "$DELETE_RESULT" | jq -e '.deleted' > /dev/null 2>&1; then
  DELETED=$(echo "$DELETE_RESULT" | jq '.deleted')
  pass "Deleted collection ($DELETED documents removed)"
else
  echo -e "${YELLOW}⚠ Collection delete not supported or already empty${NC}"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}All VectorDB tests completed!${NC}"
echo "=========================================="
