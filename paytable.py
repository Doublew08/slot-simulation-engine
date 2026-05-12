"""
Symbol definitions and paytable lookups.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Symbol:
    name: str
    payouts: Dict[int, float] = field(default_factory=dict)  # {count: multiplier}
    is_wild: bool = False
    is_scatter: bool = False
    is_coin: bool = False


class Paytable:
    def __init__(self, symbols: List[Symbol]) -> None:
        self._symbols: Dict[str, Symbol] = {s.name: s for s in symbols}
        self.wild_name: Optional[str] = next(
            (s.name for s in symbols if s.is_wild), None
        )
        self.scatter_name: Optional[str] = next(
            (s.name for s in symbols if s.is_scatter), None
        )
        self.coin_name: Optional[str] = next(
            (s.name for s in symbols if s.is_coin), None
        )
        # Flat (name, count) → payout dict built once at init.
        # Replaces nested _symbols[name].payouts[count] chain on every eval call.
        self._payout_lookup: Dict[tuple, float] = {
            (s.name, count): val
            for s in symbols
            for count, val in s.payouts.items()
        }

    def get(self, name: str) -> Optional[Symbol]:
        return self._symbols.get(name)

    def payout(self, name: str, count: int) -> float:
        return self._payout_lookup.get((name, count), 0.0)

    def is_wild(self, name: str) -> bool:
        sym = self._symbols.get(name)
        return sym is not None and sym.is_wild

    def is_scatter(self, name: str) -> bool:
        sym = self._symbols.get(name)
        return sym is not None and sym.is_scatter

    def is_coin(self, name: str) -> bool:
        sym = self._symbols.get(name)
        return sym is not None and sym.is_coin

    def is_special(self, name: str) -> bool:
        """True for wild, scatter, or coin — not a regular paying symbol."""
        sym = self._symbols.get(name)
        return sym is not None and (sym.is_wild or sym.is_scatter or sym.is_coin)

    def all_symbols(self) -> List[Symbol]:
        return list(self._symbols.values())
