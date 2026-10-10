# DWN — standalone C++20 experiment

This folder contains a standalone C++20 DWN-oriented component with a LevelDB-backed storage implementation.

## Scope and integration boundary

The canonical CMake target in `CMakeLists.txt` links LevelDB and removes `src/postgres_storage.cpp` from its build. PostgreSQL environment variables are not proof that PostgreSQL support is compiled or exercised.

This component is separate from the main MILAN Express application. Its presence here does **not** mean the production web/API path sends signed DWN protocol messages to it. See [the production protocol status](../docs/REAL_DWN_IMPLEMENTATION.md).

## Local build

System dependencies are required (CMake 3.20+, C++20 compiler, Boost, OpenSSL, LevelDB, nlohmann/json and GTest when tests are enabled):

```bash
cmake -S . -B build -DBUILD_TESTS=ON
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

A local build/test result must be recorded before claiming that this component is buildable and healthy on a particular target environment.
