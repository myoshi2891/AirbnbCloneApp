import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

type FormInputProps = {
	name: string;
	type: string;
	label?: string;
	defaultValue?: string;
	placeholder?: string;
};

function FormInput(props: FormInputProps) {
	const { label, name, type, defaultValue, placeholder } = props;
	return (
		<div className="mb-2">
			<Label htmlFor={name} className="capitalize">
				{label || name}
			</Label>
			<Input
				type={type}
				id={name}
				name={name}
				defaultValue={defaultValue}
				placeholder={placeholder}
				required
			/>
		</div>
	);
}

export default FormInput;
