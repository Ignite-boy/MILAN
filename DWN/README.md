# DWN — C++20 Decentralized Web Node

A lightweight C++20 Decentralized Web Node (DWN) for secure, user-owned data storage and Web5 applications.

## Storage

DWN uses **LevelDB** as its local persistent storage backend.

Logical storage namespaces include:

- Records / message metadata
- Binary record data
- Tenant state
- Snapshots
- Events

The binary data path stores the actual record payload bytes directly in LevelDB.

## Quick Start

### Local

```bash
cmake -S . -B build
cmake --build build
./build/DWN
