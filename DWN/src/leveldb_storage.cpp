#include <leveldb/write_batch.h>
#include "dwn/leveldb_storage.hpp"
#include <chrono>
#include <random>
#include <sstream>
#include <iostream>

namespace dwn {

static std::string json_record(const Record& r) {
    nlohmann::json j = {
        {"recordId", r.recordId},
        {"targetDid", r.targetDid},
        {"ownerDid", r.ownerDid},
        {"schema", r.schema},
        {"dataFormat", r.dataFormat},
        {"protocol", r.protocol},
        {"protocolPath", r.protocolPath},
        {"recipient", r.recipient},
        {"published", r.published},
        {"dateCreated", r.dateCreated},
        {"dateModified", r.dateModified},
        {"deleted", r.deleted},
        {"metadata", r.metadata},
        {"dataCid", r.dataCid},
        {"dataSize", r.dataSize},
        {"lastEventId", r.lastEventId}
    };
    return j.dump();
}

static Record parse_record(const std::string& s) {
    auto j = nlohmann::json::parse(s);
    Record r;
    r.recordId = j.value("recordId", "");
    r.targetDid = j.value("targetDid", "");
    r.ownerDid = j.value("ownerDid", "");
    r.schema = j.value("schema", "");
    r.dataFormat = j.value("dataFormat", "");
    r.protocol = j.value("protocol", "");
    r.protocolPath = j.value("protocolPath", "");
    r.recipient = j.value("recipient", "");
    r.published = j.value("published", false);
    r.dateCreated = j.value("dateCreated", "");
    r.dateModified = j.value("dateModified", "");
    r.deleted = j.value("deleted", false);
    r.metadata = j.value("metadata", nlohmann::json::object());
    r.dataCid = j.value("dataCid", "");
    r.dataSize = j.value("dataSize", 0ULL);
    r.lastEventId = j.value("lastEventId", "");
    return r;
}

LevelDbStorage::LevelDbStorage(const std::string& path) : path_(path) {
    leveldb::Options options;
    options.create_if_missing = true;
    auto s = leveldb::DB::Open(options, path_, &db_);
    if (!s.ok()) throw std::runtime_error("LevelDB open failed: " + s.ToString());
    std::cout << "LevelDB: " << path_ << "\n";
}

LevelDbStorage::~LevelDbStorage() {
    std::lock_guard<std::mutex> lock(mu_);
    delete db_;
    db_ = nullptr;
}

std::string LevelDbStorage::record_meta_key(const std::string& targetDid,
                                            const std::string& recordId) const {
    return "message|" + targetDid + "|" + recordId;
}

std::string LevelDbStorage::record_data_key(const std::string& targetDid,
                                            const std::string& recordId) const {
    return "data|" + targetDid + "|" + recordId;
}

std::string LevelDbStorage::tenant_key(const std::string& targetDid) const {
    return "tenant|" + targetDid;
}

std::string LevelDbStorage::snapshot_key(const std::string& name) const {
    return "snapshot|" + name;
}

std::string LevelDbStorage::event_prefix(const std::string& targetDid) const {
    return "event|" + targetDid + "|";
}

bool LevelDbStorage::health_check() {
    std::lock_guard<std::mutex> lock(mu_);
    if (!db_) return false;
    leveldb::WriteOptions wo;
    leveldb::ReadOptions ro;
    const std::string key = "__health__";
    const std::string value = "ok";
    auto w = db_->Put(wo, key, value);
    if (!w.ok()) return false;
    std::string out;
    auto r = db_->Get(ro, key, &out);
    db_->Delete(wo, key);
    return r.ok() && out == value;
}

bool LevelDbStorage::ensure_tenant(const std::string& targetDid) {
    std::lock_guard<std::mutex> lock(mu_);
    leveldb::WriteOptions wo;
    return db_->Put(wo, tenant_key(targetDid), "1").ok();
}

bool LevelDbStorage::put_database_snapshot(const std::string& name,
                                             const nlohmann::json& data,
                                             const std::string& pushedAt) {
    std::lock_guard<std::mutex> lock(mu_);
    nlohmann::json j = {
        {"data", data},
        {"pushedAt", pushedAt}
    };
    return db_->Put(leveldb::WriteOptions(), snapshot_key(name), j.dump()).ok();
}

std::optional<nlohmann::json> LevelDbStorage::get_database_snapshot(
    const std::string& name, std::string* pushedAt) {
    std::lock_guard<std::mutex> lock(mu_);
    std::string raw;
    auto s = db_->Get(leveldb::ReadOptions(), snapshot_key(name), &raw);
    if (!s.ok()) return std::nullopt;

    try {
        auto j = nlohmann::json::parse(raw);
        if (pushedAt) *pushedAt = j.value("pushedAt", "");
        return j.value("data", nlohmann::json::object());
    } catch (...) {
        return std::nullopt;
    }
}

bool LevelDbStorage::write_record(const Record& record) {
    std::lock_guard<std::mutex> lock(mu_);
    leveldb::WriteBatch batch;

    batch.Put(record_meta_key(record.targetDid, record.recordId), json_record(record));

    // REAL BINARY PAYLOAD:
    // DataStore logical namespace stores the exact record.data bytes,
    // not a filename, not a base64 JSON envelope.
    leveldb::Slice binaryData(
        reinterpret_cast<const char*>(record.data.data()),
        record.data.size()
    );
    batch.Put(record_data_key(record.targetDid, record.recordId), binaryData);

    auto s = db_->Write(leveldb::WriteOptions(), &batch);
    return s.ok();
}

std::optional<Record> LevelDbStorage::read_record(const std::string& targetDid,
                                                    const std::string& recordId) {
    std::lock_guard<std::mutex> lock(mu_);

    std::string meta;
    auto ms = db_->Get(leveldb::ReadOptions(),
                       record_meta_key(targetDid, recordId), &meta);
    if (!ms.ok()) return std::nullopt;

    Record r;
    try {
        r = parse_record(meta);
    } catch (...) {
        return std::nullopt;
    }

    if (r.deleted) return std::nullopt;

    std::string bytes;
    auto ds = db_->Get(leveldb::ReadOptions(),
                       record_data_key(targetDid, recordId), &bytes);
    if (ds.ok()) {
        r.data.assign(bytes.begin(), bytes.end());
        r.dataSize = r.data.size();
    }
    return r;
}

std::vector<Record> LevelDbStorage::query_records(const std::string& targetDid,
                                                   const RecordsFilter& filter) {
    std::lock_guard<std::mutex> lock(mu_);
    std::vector<Record> out;
    const std::string prefix = "message|" + targetDid + "|";

    std::unique_ptr<leveldb::Iterator> it(db_->NewIterator(leveldb::ReadOptions()));
    for (it->Seek(prefix); it->Valid(); it->Next()) {
        const std::string key = it->key().ToString();
        if (key.rfind(prefix, 0) != 0) break;

        try {
            Record r = parse_record(it->value().ToString());
            if (r.deleted) continue;

            if (filter.schema && r.schema != *filter.schema) continue;
            if (filter.dataFormat && r.dataFormat != *filter.dataFormat) continue;
            if (filter.protocol && r.protocol != *filter.protocol) continue;
            if (filter.protocolPath && r.protocolPath != *filter.protocolPath) continue;
            if (filter.recipient && r.recipient != *filter.recipient) continue;
            if (filter.author && r.ownerDid != *filter.author) continue;
            if (filter.published && r.published != *filter.published) continue;

            out.push_back(std::move(r));
        } catch (...) {}
    }

    std::sort(out.begin(), out.end(),
              [](const Record& a, const Record& b) {
                  return a.dateCreated > b.dateCreated;
              });

    int offset = filter.offset.value_or(0);
    int limit = filter.limit.value_or(25);
    if (offset < 0) offset = 0;

    if (offset >= static_cast<int>(out.size())) return {};
    auto begin = out.begin() + offset;
    auto end = out.end();

    if (limit >= 0 && static_cast<int>(std::distance(begin, end)) > limit)
        end = begin + limit;

    return std::vector<Record>(begin, end);
}

bool LevelDbStorage::delete_record(const std::string& targetDid,
                                    const std::string& recordId,
                                    bool tombstone) {
    std::lock_guard<std::mutex> lock(mu_);
    if (tombstone) {
        std::string raw;
        auto s = db_->Get(leveldb::ReadOptions(),
                          record_meta_key(targetDid, recordId), &raw);
        if (!s.ok()) return false;

        try {
            auto r = parse_record(raw);
            r.deleted = true;
            r.dateModified = std::to_string(
                std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()
                ).count()
            );
            return db_->Put(leveldb::WriteOptions(),
                            record_meta_key(targetDid, recordId),
                            json_record(r)).ok();
        } catch (...) {
            return false;
        }
    }

    leveldb::WriteBatch batch;
    batch.Delete(record_meta_key(targetDid, recordId));
    batch.Delete(record_data_key(targetDid, recordId));
    return db_->Write(leveldb::WriteOptions(), &batch).ok();
}

std::string LevelDbStorage::append_event(const std::string& targetDid,
                                         const std::string& recordId,
                                         const std::string& eventType,
                                         const nlohmann::json& metadata) {
    std::lock_guard<std::mutex> lock(mu_);

    const auto now = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();

    std::string eventId = std::to_string(now);

    nlohmann::json j = {
        {"eventId", eventId},
        {"targetDid", targetDid},
        {"recordId", recordId},
        {"eventType", eventType},
        {"timestamp", now},
        {"metadata", metadata}
    };

    auto s = db_->Put(leveldb::WriteOptions(),
                      event_prefix(targetDid) + eventId,
                      j.dump());

    return s.ok() ? eventId : "";
}

std::vector<nlohmann::json> LevelDbStorage::get_events(
    const std::string& targetDid, int limit) {
    std::lock_guard<std::mutex> lock(mu_);
    std::vector<nlohmann::json> out;
    const std::string prefix = event_prefix(targetDid);

    std::unique_ptr<leveldb::Iterator> it(db_->NewIterator(leveldb::ReadOptions()));
    for (it->Seek(prefix); it->Valid(); it->Next()) {
        if (it->key().ToString().rfind(prefix, 0) != 0) break;
        try { out.push_back(nlohmann::json::parse(it->value().ToString())); }
        catch (...) {}
    }

    std::sort(out.begin(), out.end(),
              [](const auto& a, const auto& b) {
                  return a.value("timestamp", 0LL) > b.value("timestamp", 0LL);
              });

    if (limit > 0 && static_cast<int>(out.size()) > limit)
        out.resize(limit);

    return out;
}

} // namespace dwn
