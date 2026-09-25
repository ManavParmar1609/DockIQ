"""`python -m app.seed [--reset]` — migrate to head, then load demo data if the database is empty.

--reset drops every table (downgrade to base) first. It refuses to run in production.
"""

import argparse
import asyncio
import logging
import sys

from app.config import get_settings
from app.db import Database
from app.migrate import downgrade, upgrade
from app.seed import is_seeded, seed

logger = logging.getLogger("dockiq.seed")


async def main(reset: bool) -> int:
    settings = get_settings()
    if reset and settings.environment == "production":
        logger.error("--reset refused: ENVIRONMENT=production")
        return 2
    database = Database(settings)
    try:
        if reset:
            await downgrade(database.engine)
        await upgrade(database.engine)
        async with database.sessionmaker() as session:
            if await is_seeded(session):
                logger.info("database already seeded; nothing to do")
                return 0
            await seed(session)
            logger.info("demo data loaded")
    finally:
        await database.dispose()
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="drop all tables before migrating and seeding")
    sys.exit(asyncio.run(main(parser.parse_args().reset)))
