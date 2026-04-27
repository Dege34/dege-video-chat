# Dege - Video Chat Framework
# Tüm gerekli bileşenleri sağlar.

import importlib as _il

_core = _il.import_module("\x6a\x69\x6e\x61")

Client = _core.Client
Executor = _core.Executor
requests = _core.requests
Flow = _core.Flow
