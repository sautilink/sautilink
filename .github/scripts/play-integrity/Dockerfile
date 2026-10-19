# Disposable CI database only. Official version verified in docker-library/postgres.
FROM postgres:17.11-bookworm
RUN apt-get update \
    && apt-get install --yes --no-install-recommends postgresql-17-cron \
    && rm -rf /var/lib/apt/lists/*
LABEL com.sautilink.purpose="play-integrity-disposable"
CMD ["postgres", "-c", "shared_preload_libraries=pg_cron", "-c", "cron.database_name=sautilink_integrity_test", "-c", "cron.launch_active_jobs=off"]
