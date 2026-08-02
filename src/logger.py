"""Log simple a C:\\ProgramData\\AlertaPantalla\\alerta.log (fecha/hora + evento)."""
import logging
from logging.handlers import RotatingFileHandler

from config import LOG_PATH, ensure_data_dir

_logger = None


def get_logger() -> logging.Logger:
    global _logger
    if _logger is not None:
        return _logger
    ensure_data_dir()
    log = logging.getLogger("AlertaPantalla")
    log.setLevel(logging.INFO)
    if not log.handlers:
        # Rota a ~1 MB para que el log no crezca sin control en PCs 24/7
        handler = RotatingFileHandler(LOG_PATH, maxBytes=1_000_000, backupCount=2, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s  %(message)s", "%Y-%m-%d %H:%M:%S"))
        log.addHandler(handler)
    _logger = log
    return log
