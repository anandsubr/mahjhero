import { Children, isValidElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ThreadAvatar from './ThreadAvatar';
import { ClockIcon, MinusIcon, PlusIcon, XIcon } from './icons';
import { TIER_OPTIONS } from './TierPicker';
import type { SkillTier } from '../lib/bookings';
import { colors, layout, radius, shadow, type } from '../lib/theme';

/**
 * The new/edit game form's building blocks (game form handoff): grouped
 * surface cards, borderless rows, segmented controls, a per-table level
 * selector, inline toggle rows and a pinned action bar. Shared by
 * app/clubs/[id]/events/new.tsx and app/clubs/[id]/events/[eventId]/edit.tsx
 * so the two screens cannot drift apart.
 */

/** Close ✕, the club's own tile, and its name. With no `clubId` (Start a
 *  club, where there is no club yet) the tile is left out and `clubName` is
 *  just the header's label. */
export function FormHeader({
  clubId,
  clubName,
  onClose,
  closeLabel = 'Close',
}: {
  clubId?: string;
  clubName: string;
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
      >
        <XIcon size={22} color={colors.text} />
      </Pressable>
      {clubId ? (
        <ThreadAvatar kind="club" name={clubName} size={32} asTile clubId={clubId} tileSize="section" />
      ) : null}
      <Text style={styles.clubName} numberOfLines={1}>
        {clubName}
      </Text>
    </View>
  );
}

export function FormTitle({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

/** A bold label over its own card (or control), with optional helper text. */
export function FormSection({
  label,
  helper,
  children,
}: {
  label?: string;
  helper?: string | null;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
      {children}
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

/** A surface card; a hairline divides each (non-null) child from the next. */
export function FormCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.card, style]}>
      {rows.map((row, index) => (
        <View key={row.key ?? index} style={index > 0 ? styles.divided : null}>
          {row}
        </View>
      ))}
    </View>
  );
}

/** A label over a borderless input, optionally led by an icon. */
export function TextRow({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  numberOfLines,
  inputStyle,
  accessibilityLabel,
  keyboardType,
}: {
  label: string;
  icon?: ReactNode;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  /** Visible rows for a multiline input; defaults to 2. */
  numberOfLines?: number;
  inputStyle?: StyleProp<TextStyle>;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.row}>
      {icon}
      <View style={styles.rowText}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.neutral[600]}
          accessibilityLabel={accessibilityLabel}
          multiline={multiline}
          keyboardType={keyboardType}
          numberOfLines={multiline ? (numberOfLines ?? 2) : undefined}
          style={[styles.input, multiline && styles.inputMultiline, inputStyle]}
        />
      </View>
    </View>
  );
}

/** "Start time" with its date/time chips on the right. */
export function StartTimeRow({ children }: { children: ReactNode }) {
  return (
    <View style={[styles.row, styles.startRow]}>
      <ClockIcon size={18} color={colors.accent2[700]} />
      <Text style={styles.startLabel}>Start time</Text>
      <View style={styles.startChips}>{children}</View>
    </View>
  );
}

/** A row label with small chips under it -- "How long?", "Does it repeat?". */
export function ChipsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.chipsRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

export function SmallChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      aria-selected={selected}
      style={[styles.smallChip, selected && styles.selected]}
    >
      <Text style={[styles.smallChipText, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

/** Equal-width options in a pill; `on` picks the pill's own background. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  on = 'surface',
}: {
  options: { value: T; label: string; accessibilityLabel?: string }[];
  value: T;
  onChange: (next: T) => void;
  on?: 'surface' | 'bg';
}) {
  return (
    <View style={[styles.segmented, on === 'bg' && styles.segmentedOnBg]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            aria-selected={selected}
            style={[styles.segment, selected && styles.selected]}
          >
            <Text style={[styles.segmentText, selected && styles.selectedText]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type TableDraft = { key: string; label: string; tier: SkillTier };

/**
 * The Tables card: a stepper (adds or removes the LAST table, never fewer
 * than `min`) and, per table, its name, level name and a four-way level
 * selector -- Any, then one to three pips.
 */
export function TablesCard({
  tables,
  onAdd,
  onRemove,
  onTierChange,
  min = 1,
  max = 12,
  note,
  levels = true,
}: {
  tables: TableDraft[];
  onAdd: () => void;
  onRemove: () => void;
  onTierChange: (index: number, tier: SkillTier) => void;
  min?: number;
  max?: number;
  note?: string | null;
  /** False draws the stepper alone, with no per-table rows. */
  levels?: boolean;
}) {
  const count = tables.length;
  return (
    <FormCard>
      <View style={styles.tablesHeader}>
        <Text style={styles.tablesTitle}>Tables</Text>
        <View style={styles.stepper}>
          <Pressable
            onPress={onRemove}
            disabled={count <= min}
            accessibilityRole="button"
            accessibilityLabel="Remove a table"
            aria-disabled={count <= min}
            style={[styles.stepperButton, count <= min && styles.dimmed]}
          >
            <MinusIcon size={16} color={colors.text} />
          </Pressable>
          <Text style={styles.stepperCount} accessibilityLabel={`${count} ${count === 1 ? 'table' : 'tables'}`}>
            {count}
          </Text>
          <Pressable
            onPress={onAdd}
            disabled={count >= max}
            accessibilityRole="button"
            accessibilityLabel="Add a table"
            aria-disabled={count >= max}
            style={[styles.stepperButton, count >= max && styles.dimmed]}
          >
            <PlusIcon size={16} color={colors.text} />
          </Pressable>
        </View>
      </View>
      {note ? <Text style={[styles.helper, styles.tablesNote]}>{note}</Text> : null}
      {(levels ? tables : []).map((table, index) => (
        <View key={table.key} style={styles.tableRow}>
          <View style={styles.tableRowHeader}>
            <Text style={styles.tableName}>{table.label}</Text>
            <Text style={styles.tableLevel}>
              {TIER_OPTIONS.find((o) => o.value === table.tier)?.label ?? 'Any level'}
            </Text>
          </View>
          <View style={[styles.segmented, styles.segmentedOnBg, styles.levels]}>
            {TIER_OPTIONS.map((option) => {
              const selected = option.value === table.tier;
              const color = selected ? '#ffffff' : colors.text;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onTierChange(index, option.value)}
                  accessibilityRole="button"
                  accessibilityLabel={`${table.label}: ${option.label}`}
                  aria-selected={selected}
                  style={[styles.segment, styles.levelSegment, selected && styles.selected]}
                >
                  {option.value === 'mixed' ? (
                    <Text style={[styles.segmentText, selected && styles.selectedText]}>Any</Text>
                  ) : (
                    <LevelDots filled={LEVEL_DOTS[option.value]} color={color} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </FormCard>
  );
}

const LEVEL_DOTS: Record<Exclude<SkillTier, 'mixed'>, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

function LevelDots({ filled, color }: { filled: number; color: string }) {
  return (
    <View style={styles.dots} aria-hidden>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[styles.dot, { borderColor: color }, i < filled ? { backgroundColor: color } : null]}
        />
      ))}
    </View>
  );
}

/** "Cost to play" and "Minimum spend", side by side. */
export function MoneyCards({
  fee,
  minSpend,
  onFeeChange,
  onMinSpendChange,
}: {
  fee: string;
  minSpend: string;
  onFeeChange: (next: string) => void;
  onMinSpendChange: (next: string) => void;
}) {
  return (
    <View style={styles.money}>
      {[
        { label: 'Cost to play', value: fee, onChange: onFeeChange },
        { label: 'Minimum spend', value: minSpend, onChange: onMinSpendChange },
      ].map((field) => (
        <View key={field.label} style={[styles.card, styles.moneyCard]}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          <View style={styles.moneyValue}>
            <Text style={styles.dollar}>$</Text>
            <TextInput
              value={field.value}
              onChangeText={field.onChange}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.neutral[600]}
              accessibilityLabel={field.label}
              style={styles.moneyInput}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/** A whole-row switch: icon, title, helper, and the switch itself. */
export function ToggleRow({
  icon,
  title,
  helper,
  value,
  onValueChange,
  accessibilityLabel,
}: {
  icon: ReactNode;
  title: string;
  helper: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      aria-checked={value}
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.toggleRowPressed]}
    >
      {icon ? <View style={styles.toggleIcon}>{icon}</View> : null}
      <View style={styles.rowText}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleHelper}>{helper}</Text>
      </View>
      <View style={[styles.track, value ? styles.trackOn : styles.trackOff]}>
        <View style={styles.knob} />
      </View>
    </Pressable>
  );
}

/** The centred ghost link at the foot of the form ("Cancel this game"). */
export function GhostLink({
  label,
  onPress,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.ghost, pressed && styles.ghostPressed, disabled && styles.dimmed]}
    >
      <Text style={styles.ghostText}>{label}</Text>
    </Pressable>
  );
}

/** Cancel + the primary action, pinned under the scroller. Without
 *  `onCancel` the primary action fills the bar alone (Start a club); with
 *  `disabled` it is drawn in the pale not-yet-ready treatment. */
export function ActionBar({
  onCancel,
  primaryLabel,
  primaryAccessibilityLabel,
  onPrimary,
  busy,
  disabled = false,
}: {
  onCancel?: () => void;
  primaryLabel: string;
  primaryAccessibilityLabel: string;
  onPrimary: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.actionBar, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>
      {onCancel ? (
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onPrimary}
        disabled={busy || disabled}
        accessibilityRole="button"
        accessibilityLabel={primaryAccessibilityLabel}
        aria-busy={busy}
        aria-disabled={disabled}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && !disabled && styles.primaryButtonPressed,
          disabled && styles.primaryButtonDisabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={[styles.primaryText, disabled && styles.primaryTextDisabled]}>
            {primaryLabel}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/** A bottom-sheet confirmation, in SeatSheet's shell. */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.sheetRoot}>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <View style={styles.sheet} testID="confirm-sheet">
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>{title}</Text>
          {body ? <Text style={styles.sheetBody}>{body}</Text> : null}
          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
            style={({ pressed }) => [styles.primaryButton, styles.sheetPrimary, pressed && styles.primaryButtonPressed]}
          >
            <Text style={styles.primaryText}>{confirmLabel}</Text>
          </Pressable>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
            style={styles.sheetCancel}
          >
            <Text style={styles.sheetCancelText}>{cancelLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export const formStyles = StyleSheet.create({
  // The scroller's content column: Screen's `stickyHeaderIndices` is not
  // used here, so this is its ordinary `contentStyle`.
  body: { paddingTop: 0, paddingHorizontal: 16, paddingBottom: 28, gap: 22 },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
    paddingBottom: 4,
    marginHorizontal: -8,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: { backgroundColor: colors.surface },
  clubName: { flex: 1, fontFamily: type.bodyBold, fontSize: 16, color: colors.text },
  title: {
    fontFamily: type.heading,
    fontSize: 32,
    lineHeight: 35,
    color: colors.text,
    paddingHorizontal: 4,
  },
  section: { gap: 8 },
  sectionLabel: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text, paddingHorizontal: 6 },
  helper: {
    fontFamily: type.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral[700],
    paddingHorizontal: 6,
  },
  card: { backgroundColor: colors.surface, borderRadius: 20 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  rowText: { flex: 1, minWidth: 0 },
  fieldLabel: { fontFamily: type.bodySemiBold, fontSize: 12, color: colors.neutral[700] },
  input: {
    fontFamily: type.bodySemiBold,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 2,
    backgroundColor: 'transparent',
    outlineStyle: 'none' as never,
  },
  inputMultiline: { minHeight: 44, textAlignVertical: 'top' },
  startRow: { paddingVertical: 10, flexWrap: 'wrap' },
  startLabel: { flex: 1, fontFamily: type.bodyRegular, fontSize: 15, color: colors.text },
  startChips: { flexDirection: 'row', gap: 6 },
  chipsRow: { paddingTop: 10, paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  smallChip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallChipText: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.text },
  selected: { backgroundColor: colors.accent[700] },
  selectedText: { color: '#ffffff' },
  segmented: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  segmentedOnBg: { backgroundColor: colors.bg },
  segment: {
    flex: 1,
    minWidth: 0,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  tablesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 8,
  },
  tablesTitle: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  tablesNote: { paddingHorizontal: 16, paddingVertical: 10 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  stepperButton: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperCount: {
    minWidth: 22,
    textAlign: 'center',
    fontFamily: type.heading,
    fontSize: 18,
    color: colors.text,
  },
  tableRow: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  tableRowHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  tableName: { fontFamily: type.heading, fontSize: 17, color: colors.text },
  tableLevel: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
  levels: { padding: 3 },
  levelSegment: { height: 36 },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 8, height: 8, borderRadius: radius.pill, borderWidth: 2 },
  money: { flexDirection: 'row', gap: 8 },
  moneyCard: { flex: 1, minWidth: 0, paddingTop: 10, paddingHorizontal: 16, paddingBottom: 12 },
  moneyValue: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  dollar: { fontFamily: type.heading, fontSize: 22, color: colors.neutral[700] },
  moneyInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: type.heading,
    fontSize: 22,
    color: colors.text,
    paddingVertical: 2,
    backgroundColor: 'transparent',
    outlineStyle: 'none' as never,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 14,
  },
  toggleRowPressed: { opacity: 0.85 },
  toggleIcon: { paddingTop: 1 },
  toggleTitle: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  toggleHelper: {
    fontFamily: type.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral[700],
    marginTop: 2,
  },
  track: {
    width: 50,
    height: 30,
    borderRadius: radius.pill,
    padding: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackOn: { backgroundColor: colors.accentColor, justifyContent: 'flex-end' },
  trackOff: { backgroundColor: colors.neutral[400], justifyContent: 'flex-start' },
  knob: { width: 24, height: 24, borderRadius: radius.pill, backgroundColor: '#ffffff', ...shadow.sm },
  ghost: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.pill },
  ghostPressed: { backgroundColor: colors.surface },
  ghostText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.accent[700] },
  dimmed: { opacity: 0.4 },
  actionBar: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.bg,
  },
  cancelButton: {
    height: 50,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonPressed: { backgroundColor: colors.neutral[300] },
  cancelText: { fontFamily: type.bodyBold, fontSize: 16, color: colors.text },
  primaryButton: {
    flex: 1,
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: { backgroundColor: colors.accent[800] },
  primaryButtonDisabled: { backgroundColor: colors.accent[300] },
  primaryText: { fontFamily: type.bodyBold, fontSize: 16, color: '#ffffff' },
  primaryTextDisabled: { color: colors.accent[100] },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(46, 43, 37, 0.4)',
  },
  sheet: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 34,
    gap: 10,
    ...shadow.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.neutral[400],
    marginBottom: 6,
  },
  sheetTitle: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  sheetBody: { fontFamily: type.bodyRegular, fontSize: 15, lineHeight: 21, color: colors.neutral[800] },
  sheetPrimary: { flex: 0, marginTop: 4 },
  sheetCancel: { height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetCancelText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.neutral[700] },
});
