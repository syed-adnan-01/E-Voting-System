import time
import os
import sys
from pathlib import Path

# Add face-service directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.embedding_store import save_profile, load_all_profiles, delete_profile, invalidate_cache

def test_embedding_cache():
    print("[TEST] Running Phase 5 Vector Cache Verification...")
    
    # 1. Populate test profiles
    test_id = "test_subj_999"
    dummy_embedding = [0.1] * 512
    save_profile(test_id, "SUBJ999", [dummy_embedding])
    
    # 2. First call (Cache Miss - reads disk & decrypts)
    t0 = time.perf_counter()
    profs1 = load_all_profiles()
    t_miss = (time.perf_counter() - t0) * 1000
    assert test_id in profs1, "Profile present on cache miss"
    
    # 3. Second call (Cache Hit - in memory)
    t0 = time.perf_counter()
    profs2 = load_all_profiles()
    t_hit = (time.perf_counter() - t0) * 1000
    assert test_id in profs2, "Profile present on cache hit"
    assert profs1 is profs2, "Identical in-memory reference returned"
    
    print(f"[METRIC] Cache Miss: {t_miss:.3f}ms | Cache Hit: {t_hit:.3f}ms")
    
    # 4. Invalidation check on delete
    delete_profile(test_id)
    profs3 = load_all_profiles()
    assert test_id not in profs3, "Profile invalidated and removed on delete"
    
    print("[SUCCESS] PHASE 5 CACHE VERIFICATION PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_embedding_cache()
