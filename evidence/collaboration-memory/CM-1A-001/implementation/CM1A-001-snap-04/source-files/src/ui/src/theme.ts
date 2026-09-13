import { createTheme, type MantineColorsTuple } from '@mantine/core';

const brand: MantineColorsTuple = ['#e7f1ff', '#cfe0ff', '#9dbeff', '#6799ff', '#3d7bfd', '#2468f2', '#185fef', '#0b4fd6', '#0045c0', '#003ba9'];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  fontFamily: 'system-ui, -apple-system, "Segoe UI", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  fontFamilyMonospace: '"Cascadia Mono", Consolas, "SFMono-Regular", "Noto Sans Mono CJK SC", monospace',
  defaultRadius: 'sm',
  fontSizes: { xs: '11px', sm: '12.5px', md: '14px', lg: '16px', xl: '18px' },
  headings: { sizes: { h1: { fontSize: '18px' }, h2: { fontSize: '15px' }, h3: { fontSize: '13.5px' } } },
  components: {
    Button: { defaultProps: { size: 'xs' } },
    ActionIcon: { defaultProps: { size: 'sm', variant: 'subtle' } },
    TextInput: { defaultProps: { size: 'xs' } },
    Textarea: { defaultProps: { size: 'xs', autosize: true } },
    Select: { defaultProps: { size: 'xs' } },
    NumberInput: { defaultProps: { size: 'xs' } },
    Badge: { defaultProps: { size: 'sm', variant: 'light' } },
    Tooltip: { defaultProps: { openDelay: 400, withArrow: true } },
  },
});
