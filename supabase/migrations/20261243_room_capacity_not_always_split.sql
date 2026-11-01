-- Room capacity that the supplier does not split by age.
--
-- library_item_room_types.max_children was NOT NULL DEFAULT 0, so a room could
-- only ever state a number. That made two different contracts read the same
-- way: "this room takes no children" and "this property does not tell adults
-- and children apart - it sleeps N people". Both stored 0 children, and the
-- allocator refused a child in either case, so a family villa could not be
-- sold to a family until the operator guessed that the box needed a number.
--
-- NULL now means the property sets no separate child cap: any guest takes any
-- bed and the room's max_occupancy is the only limit. A typed 0 keeps its
-- original meaning - the room takes no children.
--
-- max_adults is untouched. An adult cap that is not stated is sleeps, which is
-- the number the editor already writes, so it never needed a third state.
--
-- The rate snapshot copies the same column and was already nullable, so a line
-- saved before this change carries no cap - which is how it has always read it.

ALTER TABLE public.library_item_room_types
  ALTER COLUMN max_children DROP DEFAULT,
  ALTER COLUMN max_children DROP NOT NULL;

COMMENT ON COLUMN public.library_item_room_types.max_children IS
  'Beds reserved for children. NULL when the property does not differentiate adults from children - the room then takes any mix up to max_occupancy; 0 when it takes no children.';

NOTIFY pgrst, 'reload schema';
