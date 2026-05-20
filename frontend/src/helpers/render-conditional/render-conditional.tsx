import { Fragment } from 'react';

import type { Key, ReactNode } from 'react';

interface RenderIfProps {
  condition: boolean;
  then: ReactNode;
  otherwise: ReactNode;
}

const renderNodeOrNull = (node: ReactNode): ReactNode => {
	if (node)
		return node;

	return null;
};

const renderFirstTruthyNode = (node: ReactNode, fallback: ReactNode): ReactNode => {
	const renderedNode = renderNodeOrNull(node);

	if (renderedNode !== null)
		return renderedNode;

	return renderNodeOrNull(fallback);
};

const RenderIf = ({ condition, then, otherwise }: RenderIfProps): ReactNode =>
	condition ? then : renderNodeOrNull(otherwise);

interface RenderSwitchProps<T> {
  value: keyof T;
  cases: T;
  defaultCase: ReactNode;
}

const RenderSwitch = <
  T extends Record<string | number | symbol, ReactNode>,
>({
		value,
		cases,
		defaultCase,
	}: RenderSwitchProps<T>): ReactNode =>
		renderFirstTruthyNode(cases[String(value)], defaultCase);

interface RenderForProps<T> {
  list: ReadonlyArray<T>;
  children: (item: T, index?: number) => ReactNode;
}

const RenderFor = <T extends Key | null | undefined>({
	list,
	children,
}: RenderForProps<T>): ReactNode =>
		list.map((item, index) => (
			<Fragment key={item}>{children(item, index)}</Fragment>
		));

export { RenderIf, RenderSwitch, RenderFor };
