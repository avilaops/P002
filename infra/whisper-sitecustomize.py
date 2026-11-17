"""Compatibilidade entre faster-whisper 1.1 e PyAV 19.

O faster-whisper 1.1 ainda envia ``metadata_errors`` para ``av.open``. O
argumento foi removido no PyAV 19. A imagem de transcrição fixa essas duas
versões, portanto descartamos somente esse argumento obsoleto antes de abrir o
arquivo. O restante da chamada permanece inalterado.
"""

import av


_original_open = av.open


def _compatible_open(*args, **kwargs):
    kwargs.pop("metadata_errors", None)
    return _original_open(*args, **kwargs)


av.open = _compatible_open
