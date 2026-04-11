import { theme } from '../../styles/theme';

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
}

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  emptyMessage = 'No records found.',
  selectedKeys,
  onSelectionChange,
}: DataTableProps<T>) {
  const selectable = !!onSelectionChange;

  const toggleRow = (key: string) => {
    if (!selectedKeys || !onSelectionChange) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  };

  const toggleAll = () => {
    if (!onSelectionChange) return;
    const allKeys = data.map(getRowKey);
    if (selectedKeys && selectedKeys.size === allKeys.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(allKeys));
    }
  };

  return (
    <div
      style={{
        width: '100%',
        overflowX: 'auto',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: theme.typography.fontFamily,
        }}
      >
        <thead>
          <tr
            style={{
              borderBottom: `1px solid ${theme.colors.borderDefault}`,
            }}
          >
            {selectable && (
              <th
                style={{
                  width: '36px',
                  padding: '8px 12px',
                  textAlign: 'left',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!selectedKeys && data.length > 0 && selectedKeys.size === data.length}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer', accentColor: theme.colors.primary }}
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  padding: '8px 12px',
                  textAlign: 'left',
                  fontSize: theme.typography.sizes.xs,
                  fontWeight: theme.typography.weights.semibold,
                  color: theme.colors.textMuted,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  width: col.width,
                  whiteSpace: 'nowrap',
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                style={{
                  padding: '32px 12px',
                  textAlign: 'center',
                  color: theme.colors.textMuted,
                  fontSize: theme.typography.sizes.sm,
                }}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row) => {
              const key = getRowKey(row);
              const isSelected = selectedKeys?.has(key);
              return (
                <tr
                  key={key}
                  onClick={() => onRowClick?.(row)}
                  style={{
                    borderBottom: `1px solid ${theme.colors.borderSubtle}`,
                    background: isSelected ? theme.colors.primaryLight : 'transparent',
                    cursor: onRowClick ? 'pointer' : undefined,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      (e.currentTarget as HTMLTableRowElement).style.background =
                        theme.colors.bgSubtle;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = isSelected
                      ? theme.colors.primaryLight
                      : 'transparent';
                  }}
                >
                  {selectable && (
                    <td
                      style={{ padding: '10px 12px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRow(key);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!isSelected}
                        onChange={() => toggleRow(key)}
                        style={{ cursor: 'pointer', accentColor: theme.colors.primary }}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        padding: '10px 12px',
                        fontSize: theme.typography.sizes.sm,
                        color: theme.colors.textPrimary,
                        verticalAlign: 'middle',
                      }}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
