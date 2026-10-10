#pragma once
#include "storage.hpp"
#include <leveldb/db.h>
#include <mutex>
#include <string>

namespace dwn {

class LevelDbStorage : public Storage {
public:
    explicit LevelDbStorage(const std::string& path);
    ~LevelDbStorage() override;

    bool health_check() override;
    bool ensure_tenant(const std::string& targetDid) override;

    bool put_database_snapshot(const std::string& name,
                               const nlohmann::json& data,
                               const std::string& pushedAt);
    std::optional<nlohmann::json> get_database_snapshot(const std::string& name,
                                                        std::string* pushedAt = nullptr);

    bool write_record(const Record& record) override;
    std::optional<Record> read_record(const std::string& targetDid,
                                       const std::string& recordId) override;
    std::vector<Record> query_records(const std::string& targetDid,
                                      const RecordsFilter& filter) override;
    bool delete_record(const std::string& targetDid,
                       const std::string& recordId,
                       bool tombstone) override;

    std::string append_event(const std::string& targetDid,
                             const std::string& recordId,
                             const std::string& eventType,
                             const nlohmann::json& metadata) override;
    std::vector<nlohmann::json> get_events(const std::string& targetDid,
                                           int limit) override;

    const std::string& path() const { return path_; }

private:
    std::string path_;
    leveldb::DB* db_{nullptr};
    std::mutex mu_;

    std::string record_meta_key(const std::string& targetDid,
                                const std::string& recordId) const;
    std::string record_data_key(const std::string& targetDid,
                                const std::string& recordId) const;
    std::string tenant_key(const std::string& targetDid) const;
    std::string snapshot_key(const std::string& name) const;
    std::string event_prefix(const std::string& targetDid) const;
};

} // namespace dwn
