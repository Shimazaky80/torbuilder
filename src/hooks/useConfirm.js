import { useCallback, useState } from 'react';

export const useConfirm = () => {
  const [state, setState] = useState(null);

  const confirm = useCallback((opts = {}) => (
    new Promise((resolve) => {
      setState({ ...opts, resolve });
    })
  ), []);

  const settle = useCallback((result) => {
    setState((prev) => {
      if (prev) prev.resolve(result);
      return null;
    });
  }, []);

  const dialogProps = state
    ? {
      ...state,
      onCancel: () => settle(false),
      onConfirm: () => settle(true)
    }
    : null;

  return [dialogProps, confirm];
};

export default useConfirm;
